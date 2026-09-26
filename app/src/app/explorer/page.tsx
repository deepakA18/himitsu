import { Suspense } from 'react';
import Explorer from './view';
export const metadata = { title: 'Himitsu · Transaction explorer' };
export default function Page() {
  return (
    <Suspense
      fallback={
        <main>
          <h1>Himitsu explorer</h1>
          <p role="status">Loading explorer…</p>
        </main>
      }
    >
      <Explorer />
    </Suspense>
  );
}
