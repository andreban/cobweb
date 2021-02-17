
import {EditorState, EditorView, basicSetup} from '@codemirror/basic-setup';
import {python} from '@codemirror/lang-python';

const DEFAULT_DOC = `from machine import Pin, Timer
led = Pin(25, Pin.OUT)
timer = Timer()

def blink(timer):
    led.toggle()

timer.init(freq=2.5, mode=Timer.PERIODIC, callback=blink)
print("Hello, World")`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const connect = (document.querySelector('#connect') as HTMLButtonElement);
const disconnect = (document.querySelector('#disconnect') as HTMLButtonElement);
const resetButtom = (document.querySelector('#reset') as HTMLButtonElement);
const runButton = (document.querySelector('#run') as HTMLButtonElement);
const editorView = new EditorView({
  state: EditorState.create({
    extensions: [
      basicSetup,
      python(),
    ],
    doc: DEFAULT_DOC
  }),
  parent: document.querySelector('#editor'),
});

let replMark = -1;
let sendUpdates = true;
const replView = new EditorView({
  state: EditorState.create({
    extensions: [
      basicSetup,
      // This filter prevents changing text before `replMark`.
      EditorState.transactionFilter.of(t => {
        let valid = true;
        t.changes.iterChanges((fromA, _toA, fromB, _toB, _inserted) => {
          if (fromA <= replMark || fromB <= replMark) {
            valid = false;
          }
        });
        return valid ? t : null;
      }),

      // This filter checks for a `\n` character and resets `replMark`.
      EditorView.updateListener.of(update => {
        if(!sendUpdates) {
          return;
        }
        update.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
          const iter = inserted.iter();
          while (!iter.done) {
            if (iter.value === '\n') {
              sendCommand(update.state.sliceDoc(replMark+1, toB-1));
              replMark = toB - 1;
            }
            iter.next();
          }
        });
      }),
    ],
  }),
  parent: document.querySelector('#repl'),
});

replMark = replView.state.doc.length - 1;


let port: SerialPort;
let writer: WritableStreamDefaultWriter<Uint8Array>;
let reader: ReadableStreamDefaultReader<Uint8Array>;

async function readLoop() {
  while (true) {
    const {value, done} = await reader.read();
    if (value) {
      sendUpdates = false;
      replView.dispatch({
        changes: {from: replView.state.doc.length, insert: decoder.decode(value)},
      });
      replView.dispatch({
        selection: {anchor: replView.state.doc.length},
      })
      sendUpdates = true;
      replView.scrollPosIntoView(replView.state.doc.length);
      replMark = replView.state.doc.length - 1;

    }
    if (done) {
      reader.releaseLock();
      break;
    }
  }      
}

async function sendProgram(code: string) {
  await writer.write(Uint8Array.from([0x13, 0x03, 0x03]));
  await writer.write(Uint8Array.from([0x13, 0x01]));
  code.split('\n').forEach(async line => await writer.write(encoder.encode(line + '\r')));
  await writer.write(Uint8Array.from([0x04]));
  await writer.write(Uint8Array.from([0x02]));
}

function sendCommand(command: string) {
  writer.write(encoder.encode(command + '\r\n'));      
}

async function exitRawRepl() {
  await writer.write(Uint8Array.from([0x02]));
}
async function reset() {
  // ctrl-C twice: interrupt any running program
  await writer.write(Uint8Array.from([0x13, 0x03, 0x03]));
  
  // Ctrl-A: enter raw REPL
  await writer.write(Uint8Array.from([0x13, 0x01]));
  
  //  ctrl-D: soft reset
  await writer.write(Uint8Array.from([0x04]));

  // ctrl+B: exit raw REPL
  await writer.write(Uint8Array.from([0x02]));
}

disconnect.addEventListener('click', async () => {
  await writer.close();
  await reader.cancel();
  await port.close();
  disconnect.disabled = true;
  connect.disabled = false;
  resetButtom.disabled = true;
  runButton.disabled = true;
});

connect.addEventListener('click', async () => {
  port = await navigator.serial!.requestPort();
  await port.open({
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1
  });

  writer = port.writable.getWriter()
  reader = port.readable.getReader();

  readLoop();
  exitRawRepl();
  connect.disabled = true;
  disconnect.disabled = false;
  resetButtom.disabled = false;
  runButton.disabled = false;
});

resetButtom.addEventListener('click', async() => {
  reset();
});

runButton.addEventListener('click', () => {
  let command = editorView.state.doc.sliceString(0, editorView.state.doc.length);
  console.log(command);
  sendProgram(command);
});
