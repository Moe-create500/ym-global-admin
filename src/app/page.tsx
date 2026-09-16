import { redirect } from 'next/navigation';

/** Internal system — no public landing page. The root sends you into the
 *  dashboard; middleware bounces to /login when there is no session. */
export default function Root() {
  redirect('/dashboard');
}
