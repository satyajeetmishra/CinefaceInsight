"""
app/server.py
--------------
Flask backend for the Game of Thrones face recognition app. Combines two
independent methods on the same FaceNet512 embedding - nearest-centroid and
a small trained classifier - and only trusts a prediction when both agree
AND clear their own confidence threshold.

Run from the project root: python app/server.py
"""
import sys
import threading
import webbrowser
import subprocess
import os
import json
import numpy as np
import cv2
from flask import Flask, render_template, request, jsonify
from PIL import Image

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except AttributeError:
    pass

from deepface import DeepFace
import keras

from src.face_detector import detect_faces

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

PORT = int(os.environ.get('PORT', 5001))
IS_HOSTED = bool(os.environ.get('SPACE_ID'))  # set automatically on Hugging Face Spaces

FACENET_MODEL_NAME = 'Facenet512'
CLASSIFIER_PATH = os.path.join(PROJECT_ROOT, 'models', 'facenet_classifier.keras')
CENTROID_DIR = os.path.join(PROJECT_ROOT, 'models', 'centroids')
CLASS_NAMES_PATH = os.path.join(PROJECT_ROOT, 'models', 'embeddings', 'class_names.json')
INFO_PATH = os.path.join(PROJECT_ROOT, 'src', 'info.json')

CENTROID_THRESHOLD = 0.60
CLASSIFIER_THRESHOLD = 0.80

try:
    with open(CLASS_NAMES_PATH) as f:
        class_names = json.load(f)
    print(f"✅ Loaded {len(class_names)} class names")
except Exception as e:
    print(f"❌ Error loading class names: {e}")
    class_names = []

try:
    centroids = np.zeros((len(class_names), 512), dtype=np.float32)
    for i, name in enumerate(class_names):
        centroids[i] = np.load(os.path.join(CENTROID_DIR, f'{name}.npy'))
    print(f"✅ Loaded {len(class_names)} centroid vectors")
except Exception as e:
    print(f"❌ Error loading centroids: {e}")
    centroids = None

try:
    classifier = keras.models.load_model(CLASSIFIER_PATH)
    print("✅ facenet_classifier.keras loaded successfully")
except Exception as e:
    print(f"❌ Error loading classifier: {e}")
    classifier = None

try:
    with open(INFO_PATH, 'r') as f:
        character_info = json.load(f)
    print("✅ Character info loaded successfully")
except Exception as e:
    print(f"❌ Error loading character info: {e}")
    character_info = {}


def cosine_sim(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def get_embedding(pil_image):
    img_bgr = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    result = DeepFace.represent(
        img_path=img_bgr,
        model_name=FACENET_MODEL_NAME,
        detector_backend='skip',
        enforce_detection=False,
    )
    return np.array(result[0]['embedding'], dtype=np.float32)


def warm_up_model():
    try:
        dummy = np.zeros((160, 160, 3), dtype=np.uint8)
        DeepFace.represent(
            img_path=dummy,
            model_name=FACENET_MODEL_NAME,
            detector_backend='skip',
            enforce_detection=False,
        )
        print("✅ FaceNet512 warmed up")
    except Exception as e:
        print(f"⚠️ Warm-up failed (first real request will be slower): {e}")


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload_video', methods=['POST'])
def upload_video():
    try:
        if 'video' not in request.files:
            return jsonify({'error': 'No video uploaded'}), 400

        file = request.files['video']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        allowed_extensions = ['mp4', 'avi', 'mov', 'mkv', 'webm']
        if not any(file.filename.lower().endswith(ext) for ext in allowed_extensions):
            return jsonify({'error': 'Invalid file type'}), 400

        path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(path)
        return jsonify({'video_path': path, 'status': 'success'})

    except Exception as e:
        return jsonify({'error': f'Upload failed: {str(e)}'}), 500


@app.route('/detect_faces', methods=['POST'])
def detect_frame_faces():
    try:
        if 'frame' not in request.files:
            return jsonify({'error': 'No frame uploaded'}), 400

        file = request.files['frame']
        img = Image.open(file.stream).convert('RGB')
        img = np.array(img)

        faces = detect_faces(img)

        if len(faces) == 0:
            return jsonify({'faces': [], 'message': 'No faces detected'})

        print(f"✅ Detected {len(faces)} faces")
        return jsonify({'faces': faces, 'count': len(faces)})

    except Exception as e:
        print(f"❌ Error in face detection: {e}")
        return jsonify({'error': f'Face detection failed: {str(e)}'}), 500


@app.route('/predict_face', methods=['POST'])
def predict_face():
    try:
        if 'face' not in request.files:
            return jsonify({'error': 'No face uploaded'}), 400

        if classifier is None or centroids is None or not class_names:
            return jsonify({'error': 'Model not loaded'}), 500

        file = request.files['face']
        img = Image.open(file.stream).convert('RGB')

        if img.width < 5 or img.height < 5:
            return jsonify({'error': 'Face crop too small, try a different frame'}), 400

        embedding = get_embedding(img)

        sims = np.array([cosine_sim(embedding, c) for c in centroids])
        centroid_idx = int(np.argmax(sims))
        centroid_name = class_names[centroid_idx]

        probs = classifier.predict(embedding[np.newaxis, :], verbose=0)[0]
        classifier_idx = int(np.argmax(probs))
        classifier_name = class_names[classifier_idx]
        classifier_confidence = float(probs[classifier_idx])

        print(f"  centroid says:   {centroid_name} (similarity={sims[centroid_idx]:.3f})")
        print(f"  classifier says: {classifier_name} (confidence={classifier_confidence:.3f})")

        centroid_similarity = float(sims[centroid_idx])

        if centroid_name != classifier_name:
            print(f"⚠️ Disagreement ({centroid_name} vs {classifier_name}) — treating as unclear")
            return jsonify({
                'status': 'low_confidence',
                'confidence': classifier_confidence,
                'message': "Couldn't confidently recognize this face. Try a clearer frame — or this may not be one of the 15 main characters this model knows."
            })

        if centroid_similarity < CENTROID_THRESHOLD:
            print(f"⚠️ Agreed on {centroid_name} but centroid similarity too low ({centroid_similarity:.2f} < {CENTROID_THRESHOLD}) — treating as unclear")
            return jsonify({
                'status': 'low_confidence',
                'confidence': classifier_confidence,
                'message': "Couldn't confidently recognize this face. Try a clearer frame — or this may not be one of the 15 main characters this model knows."
            })

        if classifier_confidence < CLASSIFIER_THRESHOLD:
            print(f"⚠️ Agreed on {centroid_name} but classifier confidence too low ({classifier_confidence:.2f} < {CLASSIFIER_THRESHOLD}) — treating as unclear")
            return jsonify({
                'status': 'low_confidence',
                'confidence': classifier_confidence,
                'message': "Couldn't confidently recognize this face. Try a clearer frame — or this may not be one of the 15 main characters this model knows."
            })

        info = character_info.get(centroid_name, 'No info available')
        print(f"✅ Both methods agree: {centroid_name} (confidence: {classifier_confidence:.2f})")

        return jsonify({
            'prediction': centroid_name,
            'info': info,
            'confidence': classifier_confidence,
            'status': 'success'
        })

    except Exception as e:
        print(f"❌ Error in face prediction: {e}")
        return jsonify({'error': f'Prediction failed: {str(e)}'}), 500


def open_browser():
    url = f"http://127.0.0.1:{PORT}/"
    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for chrome_path in chrome_paths:
        if os.path.isfile(chrome_path):
            subprocess.Popen([chrome_path, "--start-maximized", "--new-window", url])
            return
    webbrowser.open_new(url)


if __name__ == '__main__':
    print(f"🚀 Starting FaceNet Flask application on port {PORT}...")
    warm_up_model()
    if not IS_HOSTED:
        threading.Timer(1.25, open_browser).start()
    app.run(debug=False, use_reloader=False, host='0.0.0.0', port=PORT)
