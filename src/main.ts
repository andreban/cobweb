import {ReplInterface} from './ReplInterface';
import {CodeEditor} from './CodeEditor';
import {ReplEditor} from './ReplEditor';

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
const replEditor = new ReplEditor(document.querySelector('#repl'));

disconnect.addEventListener('click', async () => {
  await replInterface.disconnect();
  disconnect.disabled = true;
  connect.disabled = false;
  resetButton.disabled = true;
  runButton.disabled = true;
});

connect.addEventListener('click', async () => {
  replInterface = await ReplInterface.connect(115200, 8, 1);
  replInterface.addEventListener('data', e => {
    replEditor.append((e as CustomEvent).detail);
  });

  replEditor.addEventListener('code', e => {
    replInterface.send((e as CustomEvent).detail);
  });

  connect.disabled = true;
  disconnect.disabled = false;
  resetButton.disabled = false;
  runButton.disabled = false;
});

resetButton.addEventListener('click', async() => {
  await replInterface.reset();
});

runButton.addEventListener('click', () => {
  replInterface.sendRaw(codeEditor.getContent());
});
