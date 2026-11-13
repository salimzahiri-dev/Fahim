import { loadRegistries } from '../modules';
import { PILOT_LESSON_ID } from './server/pilot';
import { SessionScreen } from './session/SessionScreen';

export default function HomePage() {
  const lesson = loadRegistries().lessons.get(PILOT_LESSON_ID);
  return <SessionScreen lessonTitle={lesson?.title ?? 'Fahim'} />;
}
