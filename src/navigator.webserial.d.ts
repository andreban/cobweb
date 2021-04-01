/*
 * Copyright 2021 Google Inc. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

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