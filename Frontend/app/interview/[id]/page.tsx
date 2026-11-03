import { Suspense } from "react";
import { InterviewClient } from "./InterviewClient";

type InterviewPageProps = {
  params: Promise<{ id: string }>;
};

async function InterviewContent({ params }: InterviewPageProps) {
  const { id } = await params;
  return <InterviewClient sessionId={id} />;
}

export default function InterviewPage({ params }: InterviewPageProps) {
  return (
    <Suspense
      fallback={
        <main
          aria-busy="true"
          className="flex min-h-screen items-center justify-center"
        >
          Preparing interview…
        </main>
      }
    >
      <InterviewContent params={params} />
    </Suspense>
  );
}
