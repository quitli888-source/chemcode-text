// ====== Entry Point ======
// Bootstraps the application once the DOM is ready.
// All heavy lifting is delegated to `app.ts` and `state.ts`.

import './styles.css';
import './components/index';
import './views/index';
import './app';
import { bootstrap } from './state';

void bootstrap();
