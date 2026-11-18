import '@dorsk/tsumikit/styles/app.css';
import { mount } from 'svelte';
import * as hmm from '../src/index.ts';
import App from './App.svelte';

const mountHmm = (props: hmm.Options) => mount(hmm.Hmm, { target: document.body, props });
Object.assign(window, { hmm, mountHmm });

const target = document.querySelector('#app');
if (target) mount(App, { target });
