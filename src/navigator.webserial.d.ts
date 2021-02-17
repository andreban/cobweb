type ParityType = 'none' | 'even' | 'odd';
type FlowControlType = 'none' | 'hardware';

interface SerialPortFilter {
  usbVendorId: number;
  usbProductId: number;
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}

interface SerialPortInfo {
  usbVendorId: number;
  usbProductId: number;
}

interface SerialInputSignals {
  dataCarrierDetect: boolean;
  clearToSend: boolean;
  ringIndicator: boolean;
  dataSetReady: boolean;
}

interface SerialOutputSignals {
  dataTerminalReady: boolean;
  requestToSend: boolean;
  break: boolean;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: ParityType;
  bufferSize?: number;
  flowControl?: FlowControlType;
}

interface SerialPort {
  onconnect?: EventHandlerNonNull;
  ondisconnect?: EventHandlerNonNull;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  getInfo(): SerialPortInfo;
  open(options: SerialOptions): Promise<void>;
  setSignals(signals?: SerialOutputSignals): Promise<void>;
  getSignals(): Promise<SerialInputSignals>;
  close(): Promise<void>;
}

interface WebSerial {
  onconnect?: EventHandlerNonNull;
  ondisconnect?: EventHandlerNonNull;
  requestPort(): Promise<SerialPort>
  getPorts(): Promise<SerialPort[]>
}

interface NavigatorWebSerial {
  readonly serial?: WebSerial;
}

interface Navigator extends NavigatorWebSerial {}