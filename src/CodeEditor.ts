import {EditorState, EditorView, basicSetup} from '@codemirror/basic-setup';
import {python} from '@codemirror/lang-python';

export class CodeEditor {
  private cm: EditorView;

  constructor(parent: Element, initialContent?: string) {
    this.cm = this.createCodeMirror(parent, initialContent);
  }

  public getContent(): string {
    return this.cm.state.doc.sliceString(0, this.cm.state.doc.length);
  }

  private createCodeMirror(parent: Element, initialContent?: string): EditorView {
    return new EditorView({
      state: EditorState.create({
        extensions: [
          basicSetup,
          python(),
        ],
        doc: initialContent
      }),
      parent: parent,
    });
  }
}
