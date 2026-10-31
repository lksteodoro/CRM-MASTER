import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { QuizRunner } from '../../components/quiz/QuizRunner';
import { loadPublishedQuiz, type PublishedQuiz } from '../../services/quizzes.service';

export function QuizPage() {
  const { slug = '' } = useParams();
  const [quiz, setQuiz] = useState<PublishedQuiz | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadPublishedQuiz(slug)
      .then((result) => {
        if (!active) return;
        setQuiz(result);
        document.title = result.title;
      })
      .catch((caught) => {
        if (!active) return;
        setError((caught as { status?: number }).status === 404 ? 'Este quiz não existe ou está pausado.' : 'Não foi possível abrir este quiz agora.');
      });
    return () => { active = false; };
  }, [slug]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0d12] p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold text-white">Quiz indisponível</h1>
          <p className="mt-2 text-sm text-[#9aa2b4]">{error}</p>
        </div>
      </main>
    );
  }

  if (!quiz) {
    return <main className="flex min-h-screen items-center justify-center bg-[#0b0d12]"><Loader2 className="animate-spin text-[#6284ff]" size={28} /></main>;
  }

  return (
    <div className="min-h-screen [&>div]:min-h-screen">
      <QuizRunner mode="live" slug={slug} versionId={quiz.version_id} flow={quiz.flow} theme={quiz.theme} title={quiz.title} />
    </div>
  );
}
