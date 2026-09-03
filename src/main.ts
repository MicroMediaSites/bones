// Entry point. The UI lives in src/ui/ and mounts here.
import './style.css';
import { mount } from './ui/app';

const app = document.getElementById('app');
if (app) mount(app);
