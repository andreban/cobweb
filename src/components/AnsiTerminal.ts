type AnsiTerminalState = 'input' | 'escape';
type CaretPosition = {row: number, col: number};

export class AnsiTerminal {
  private lines: string[] = [''];
  private caretPosition: CaretPosition = {row: 0, col: 0};
  private state = 'input';

  constructor() {
    console.log(this.lines);
  }

  getContent(): string {
    return this.lines.join('\n');
  }

  append(input: Uint8Array) {
    input.forEach((charCode) => this.appendChar(charCode));
  }

  private appendChar(charCode: number) {
    switch(charCode) {
      case 10: {
        this.lines.push('');
        this.caretPosition.row = this.caretPosition.row + 1;
        this.caretPosition.col = 0;
        break;
      }
      default: {
        this.lines[this.lines.length - 1] =
          this.lines[this.lines.length - 1].concat(String.fromCharCode(charCode));
          this.caretPosition.col++;
        break;
      }
    }
  }
}
