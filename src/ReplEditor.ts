import {EditorState, EditorView, basicSetup} from '@codemirror/basic-setup';
import {Annotation} from '@codemirror/state';

export class ReplEditor extends EventTarget {
  private cm: EditorView;
  private editableMark: number = -1;
  static skipEventDispatch = Annotation.define<boolean>();

  public constructor(parent: Element) {
    super();
    this.createCodeMirror(parent);
  }

  public append(content: string) {
    // Append the content to the doc.
    this.cm.dispatch({
      annotations: [ReplEditor.skipEventDispatch.of(true)],
      changes: {from: this.cm.state.doc.length, insert: content},
    });

    // Move cursor to end of doc.
    this.cm.dispatch({
      selection: {anchor: this.cm.state.doc.length},
    });

    // Scroll end of doc into view.
    this.cm.scrollPosIntoView(this.cm.state.doc.length);

    // Reset use editable area.
    this.editableMark = this.cm.state.doc.length - 1;
  }

  private createCodeMirror(parent: Element) {
    this.cm = new EditorView({
      state: EditorState.create({
        extensions: [
          basicSetup,
          this.createEditableMarkFilter(),
          this.createNewLineFilter(),
        ],
      }),
      parent: parent,
    })
  }

  private createEditableMarkFilter() {
    return EditorState.transactionFilter.of(t => {
      let valid = true;
      t.changes.iterChanges((fromA, _toA, fromB, _toB, _inserted) => {
        if (fromA <= this.editableMark || fromB <= this.editableMark) {
          valid = false;
        }
      });
      return valid ? t : null;
    })    
  }

  private createNewLineFilter() {
    return EditorView.updateListener.of(update => {
      update.transactions.forEach(t => {
        t.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
          const iter = inserted.iter();
          while (!iter.done) {
            if (iter.value === '\n') {
              if (!t.annotation(ReplEditor.skipEventDispatch)) {
                const code = update.state.sliceDoc(this.editableMark + 1, toB - 1);
                this.dispatchEvent(new CustomEvent('code', {detail: code}));
              }
              this.editableMark = toB - 1;
            }
            iter.next();
          }
        });
      });
    })
  }
}
