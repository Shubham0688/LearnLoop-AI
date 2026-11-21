export default async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Only POST requests are allowed." }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "AI service is not configured yet." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();

    const {
      topic,
      question,
      studentAnswer,
      correctAnswer,
      explanation,
      confidence
    } = body;

    if (!question || !studentAnswer) {
      return new Response(
        JSON.stringify({ error: "Question and student answer are required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = `
You are LearnLoop AI, an adaptive learning coach for Class 10 students.

Analyze this student's response.

Topic: ${topic || "General"}
Question: ${question}
Student's answer: ${studentAnswer}
Correct answer: ${correctAnswer || "Not provided"}
Student's explanation: ${explanation || "Not provided"}
Confidence level: ${confidence || "Not provided"}

Your tasks:
1. Identify whether the answer is correct, if the correct answer is provided.
2. Identify a possible misconception from the student's explanation.
3. Explain the concept in very simple language.
4. Give one practical learning suggestion.
5. Create one short follow-up question to test understanding.

Return clear, encouraging feedback using these headings:
RESULT
THINKING ANALYSIS
CONCEPT EXPLANATION
NEXT STEP
FOLLOW-UP QUESTION

Do not invent information. If evidence is insufficient, say so.
`;

    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 600
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", response.status, data.error?.status);

      return new Response(
        JSON.stringify({ error: "AI analysis failed. Please try again." }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const feedback =
      data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("\n") || "No feedback was generated.";

    return new Response(
      JSON.stringify({ success: true, feedback }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("LearnLoop function error:", error.message);

    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
