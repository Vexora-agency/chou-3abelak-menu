import {createRoot} from 'react-dom/client';
import App from '@/src/App.tsx';
import { applyTheme } from '@/src/config/theme.config';
import './index.css';

// White-label theme: push themeConfig onto :root before first render (no flash).
applyTheme();

createRoot(document.getElementById('root')!).render(<App />);
