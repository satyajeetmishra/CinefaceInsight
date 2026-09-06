# CinefaceInsight

**Ever paused a show to ask "wait, who is that again?"** — this project fixes that.

## The problem

Long-running TV shows and web series (Game of Thrones being a famous example) introduce dozens of characters, often within the first few episodes. For a new or casual viewer, keeping track of who's who — especially in the early episodes, before faces and names have "stuck" — is genuinely hard. The usual options are all disruptive: pause and Google the actor's face, scroll through a cast list on another tab, or just keep watching half-confused about who a character is and how they relate to the story.

**CinefaceInsight solves this directly inside the viewing experience.** While watching, the viewer can click on any face on screen and instantly get that character's name and a short description — no tab-switching, no searching, no breaking immersion more than a single click.

## How it works

1. **Upload a video** and play it normally in the browser.
2. **Click "Analyze Frame"** on any paused frame — the system detects every face currently on screen and draws a box around each one.
3. **Click any face** — within a second, the character's name, a confidence score, and a short bio appear in a panel next to the video.
4. If the system isn't confident enough about who it's looking at, it says so explicitly (**"Not clear enough"**) instead of guessing — a wrong confident answer is worse than an honest "I don't know."

## The technical pipeline

- **Face detection** — MTCNN locates every face in the current frame.
- **Face embedding** — each detected face is converted into a 512-dimensional vector using FaceNet512 (pretrained, kept frozen — the small dataset available for any given show isn't enough to safely fine-tune a backbone this large without overfitting).
- **Two independent classification methods, required to agree:**
  - **Nearest-centroid** — cosine similarity against each character's average embedding vector. Zero training involved, just a geometric comparison.
  - **A small trained classifier** — a lightweight dense network trained on top of the frozen embeddings.
  - A prediction is only shown when *both* methods agree on the same character *and* both clear their own confidence threshold. This agreement-gate is what lets the system say "not clear enough" instead of confidently guessing wrong.
- **Full training pipeline included** — face cropping, data augmentation (9 independent transformations), embedding extraction with resumable per-class caching, centroid computation, and classifier training are all in `notebooks/train_classifier.ipynb`.

## Not tied to Game of Thrones

The character set here — 15 main *Game of Thrones* characters — is just the **example dataset used to build and demonstrate this project**. Nothing about the pipeline is GoT-specific. The same code:
- crops and labels faces from any show's frames,
- trains embeddings + a classifier for that specific cast,
- and powers the same click-to-identify experience for **any other series, movie, or custom set of people** — just by swapping the training images.

## Real-world accuracy

Beyond the usual train/val/test split (all sourced from the same training video), the model was also evaluated on a **genuinely external test set** — images of the same 15 characters, from the **same show, but not a single frame from the training video itself**: sourced independently from the internet (different scenes, different episodes, different image quality entirely), never seen during training or augmentation. Because the model never saw these exact frames, this result demonstrates actual **learned generalization** — recognizing a character from a new angle/scene/quality it was never trained on — rather than memorization of the training footage.

**94.9% accuracy** (75/79 correct) on this external test set — raw classifier prediction, no confidence filtering applied.

## Screenshots

![Prediction example](screenshots/Screenshot%202026-09-07%20004441.png)
![Prediction example](screenshots/Screenshot%202026-09-07%20004455.png)
![Prediction example](screenshots/Screenshot%202026-09-07%20004508.png)
![Prediction example](screenshots/Screenshot%202026-09-07%20004520.png)

## Tech stack

Flask · TensorFlow / Keras · DeepFace (FaceNet512) · MTCNN · OpenCV · vanilla JS (Canvas-based UI, no frontend framework)

## Running locally

```bash
pip install -r requirements.txt
python app/server.py
```
