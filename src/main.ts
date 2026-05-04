// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import {ReplInterface} from './ReplInterface';
import {CodeEditor} from './CodeEditor';
import './components/SplitPane';
import './components/ReplShell';
import './components/FileNavigator';
import {FileNavigator} from './components/FileNavigator';
import {ReplShell} from './components/ReplShell';

const DEFAULT_DOC = `from machine import Pin, Timer
led = Pin(25, Pin.OUT)
timer = Timer()

def blink(timer):
    led.toggle()

timer.init(freq=2.5, mode=Timer.PERIODIC, callback=blink)
print("Hello, World")`;

let replInterface: ReplInterface;
const connect = (document.querySelector('#connect') as HTMLButtonElement);
const disconnect = (document.querySelector('#disconnect') as HTMLButtonElement);
const resetButton = (document.querySelector('#reset') as HTMLButtonElement);
const runButton = (document.querySelector('#run') as HTMLButtonElement);
const codeEditor = new CodeEditor(document.querySelector('#editor'), DEFAULT_DOC);
const replShell = document.querySelector('#repl') as ReplShell;
const fileNavigator = document.querySelector('#filenavigator') as FileNavigator;
const statusText = document.querySelector('#status');

disconnect.addEventListener('click', async () => {
  await replInterface.disconnect();
  statusText.textContent = 'Disconnected';
  disconnect.disabled = true;
  connect.disabled = false;
  resetButton.disabled = true;
  runButton.disabled = true;
});

replShell.addEventListener('input', e => {
  console.log(e);
  const key = (e as CustomEvent).detail.key;
  if (replInterface) {
    replInterface.send(key);
  }
});

connect.addEventListener('click', async () => {
  try {
    replInterface = await ReplInterface.connect(115200, 8, 1);
    replInterface.addEventListener('data', e => {
      replShell.appendText((e as CustomEvent).detail);
    });

    console.log('added listener :D ');

    connect.disabled = true;
    disconnect.disabled = false;
    resetButton.disabled = false;
    runButton.disabled = false;
    statusText.textContent = 'Connected';
  } catch (e) {
    statusText.textContent = `Failed to connect with error: ${e}`;
  }
});

resetButton.addEventListener('click', async() => {
  await replInterface.reset();
});

runButton.addEventListener('click', () => {
  replInterface.sendRaw(codeEditor.getContent());
});

window.addEventListener('load', () => {
  navigator.serviceWorker.register('sw.js');
});

fileNavigator.addEventListener('fileopened', (e) => {
  const evt = (e as CustomEvent);
  codeEditor.setContent(evt.detail.content);
});