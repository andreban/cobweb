import {LitElement, html, css} from 'lit';

export class FileNavigator extends LitElement {
  static styles = css`
    #root {
      background-color: white;
      width: 100%;
      height: 100%;
    }

    .controls {
      width: 100%;
      background-color: lightgrey;
    }

    .files {
      list-style: none;
      margin: 8px;
      padding: 0;
    }

    li {
      border-bottom: 1px solid #AAA;
    }
    li:hover {
      background-color: #EEE;
    }
  `;

  private directoryHandle?: FileSystemDirectoryHandle;
  private fileHandles?: Map<string, FileSystemHandle>;

  private selectDirectoryClickHandler = async() => {
    this.fileHandles = new Map();
    this.directoryHandle = await window.showDirectoryPicker();
    const entries = this.directoryHandle.entries();
    let entry = await entries.next();
    while (!entry.done) {
      console.log(entry.value[0]);
      this.fileHandles.set(entry.value[0], entry.value[1]);
      entry = await entries.next();
    }
    this.requestUpdate();
  };

  private fileSelectedClickHandler = async (e) => {
    const fileHandle = this.fileHandles.get(e.target.getAttribute('key'));
    console.log(fileHandle);
  };

  firstUpdated() {
    const refreshButton = this.renderRoot.querySelector('#refresh');
    refreshButton.addEventListener('click', this.selectDirectoryClickHandler);
  }

  updated() {
    const fileItems = this.renderRoot.querySelectorAll('li');
    fileItems.forEach(item => {
      item.addEventListener('click', this.fileSelectedClickHandler);
    });
  }

  renderFiles() {
    if (!this.fileHandles) {
      return;
    }
    const itemTemplates = [];
    this.fileHandles.forEach((value, key) => {
      itemTemplates.push(html`<li key="${key}">${key}</li>`);
    });
    return html`${itemTemplates}`;
  }

  render() {
    return html`
    <div id="root">
      <div class="controls">
        <button id="refresh">Refresh</button>
      </div>
      <ul class="files">
        ${this.renderFiles()}
      </ul>
    </div>`
  }
}

customElements.define('file-navigator', FileNavigator);
