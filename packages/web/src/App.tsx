import { SCHEMA_VERSION } from '@workout-editor/core';

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Workout Editor</h1>
      <p className="text-lg text-gray-600">
        An open-source workout builder for Garmin-compatible devices. Strength-first, no drag and
        drop required.
      </p>
      <p className="text-sm text-gray-400">
        Under construction — workout schema v{SCHEMA_VERSION}. Follow along on{' '}
        <a
          className="underline hover:text-gray-600"
          href="https://github.com/dugganm24/workout_editor"
        >
          GitHub
        </a>
        .
      </p>
    </main>
  );
}
