# LearnLoop AI — Adaptive Exam-Prep Tutor

A working, browser-based prototype for the Next Gen AI Hackathon problem statement: **Adaptive exam-prep tutor with a learner model**.

## Run it
1. Extract the ZIP.
2. Open `index.html` in Chrome/Edge. No install or API key is needed.

## Implemented prototype features
- Five-question diagnostic test for Class 10 Physics.
- Learner model tracks attempts, correct answers and per-concept mastery.
- Adaptive practice prioritises low-mastery concepts and revision-due topics.
- Feedback explains correct reasoning and flags common misconception patterns from an optional written explanation.
- Spaced-repetition schedule changes after correct/incorrect answers.
- Teacher dashboard with clearly labelled illustrative class-wide data.
- Browser persistence with localStorage and JSON export/reset.

## Architecture
`index.html` contains the UI, question bank and adaptive learning engine. The engine updates mastery after each response, ranks concepts for the next practice question, and schedules the next review date. Learner progress is stored locally in the browser.

## Important scope note
This is a functional prototype, not a production multi-user AI service. The adaptive engine and misconception checks are transparent rule-based logic; the teacher dashboard uses sample class data. No external LLM, real student accounts, cloud database, or real class analytics are connected. Clearly disclose this in your hackathon submission and describe any AI-assisted code honestly.

## Demo flow
1. Open Overview and show the empty learner profile.
2. Complete Diagnostic test.
3. Open Adaptive practice, answer a question and enter a short explanation.
4. Show updated mastery and the next revision date.
5. Open Revision plan and Teacher dashboard.

## Suggested submission description
LearnLoop AI is an adaptive Physics tutor that moves beyond one-off Q&A. It builds a per-concept learner profile from diagnostic and practice answers, prioritises weak concepts, detects common reasoning misconceptions, and schedules spaced revision. A teacher view highlights class-wide learning gaps. This submission is a working front-end prototype with local learner data and illustrative teacher analytics.
