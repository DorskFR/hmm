import '@dorsk/tsumikit/styles/app.css';
import { mount } from 'svelte';
import * as hmm from '../src/index.ts';
import App from './App.svelte';

Object.assign(window, { hmm });

const target = document.querySelector('#app');
if (target) mount(App, { target });
