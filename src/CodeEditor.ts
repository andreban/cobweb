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

import {EditorState, EditorView, basicSetup} from '@codemirror/basic-setup';
import {python} from '@codemirror/lang-python';

export class CodeEditor {
  private cm: EditorView;

  constructor(parent: Element, initialContent?: string) {
    this.cm = this.createCodeMirror(parent, initialContent);
  }

  public setContent(content: string) {
    this.cm.dispatch({
      changes: {from: 0, to: this.cm.state.doc.length, insert: content},
    });
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
