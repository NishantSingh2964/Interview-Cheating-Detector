import { InterviewClient } from "./InterviewClient";

// Next.js 16 App Router — params is a promise
export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InterviewClient sessionId={id} />;
}
