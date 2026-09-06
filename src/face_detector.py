import cv2
import numpy as np
from mtcnn import MTCNN  # type: ignore

# Initialize MTCNN detector
detector = MTCNN()

def detect_faces(frame):
    """
    Detect faces using MTCNN.
    Returns list of bounding boxes: [x, y, width, height]

    Expects `frame` in RGB format.
    """
    faces = detector.detect_faces(frame)
    boxes = []
    for face in faces:
        x, y, w, h = face['box']
        x, y = max(0, x), max(0, y)
        boxes.append([x, y, w, h])
    return boxes

def crop_faces(frame, face_boxes, margin=0.0):
    """
    Crop face regions from frame given face bounding boxes.
    Adds margin around face.
    Returns list of cropped face images (RGB).
    """
    h_frame, w_frame, _ = frame.shape
    faces_rgb = []
    
    for (x, y, w, h) in face_boxes:
        # Add margin
        x_margin = int(w * margin)
        y_margin = int(h * margin)

        x1 = max(0, x - x_margin)
        y1 = max(0, y - y_margin)
        x2 = min(w_frame, x + w + x_margin)
        y2 = min(h_frame, y + h + y_margin)

        # Crop + Convert to RGB for consistency
        face_crop = frame[y1:y2, x1:x2]
        face_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2RGB)

        faces_rgb.append(face_crop)
    
    return faces_rgb
