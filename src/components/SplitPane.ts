import {LitElement, html, css} from 'lit';

export class SplitPane extends LitElement {
  static styles = css`
      #root {
        width: 100%;
        height: 100%;
        display: flex;
        overflow: hidden;
      }

      #start-pane, #end-pane {
        overflow: auto;
        scroll-behavior: auto;
      }

      #divider {
        flex-grow: 0;
        flex-shrink: 0;
      }

      .vertical {
        flex-direction: column;
      }

      .vertical > #divider {
        height: 8px;
        width: 100%;
        cursor: row-resize;
      }

      .vertical > #start-pane {
        height: 50%;
        width: 100%;
      }

      .vertical > #end-pane {
        width: 100%;
        height: 50%;
      }

      .horizontal {
        flex-direction: row;
      }

      .horizontal > #divider {
        height: 100%;
        width: 8px;
        cursor: col-resize;
      }

      .horizontal > #start-pane {
        height: 100%;
        width: 50%;
      }

      .horizontal > #end-pane {
        height: 100%;
        width: 50%;
      }
  `;

  orientation: string;
  dragStart: number;
  startPaneInitialSize: number;

  constructor() {
    super();
    this.orientation = 'vertical'
    this.startPaneInitialSize = 50;
  }

  firstUpdated() {
    const divider = this.renderRoot.querySelector('#divider') as HTMLElement;
    const start = this.renderRoot.querySelector('#start-pane') as HTMLElement;
    const end = this.renderRoot.querySelector('#end-pane') as HTMLElement;

    if (this.orientation === 'vertical') {
      start.style.height = `${this.startPaneInitialSize}%`
      end.style.height = `${100 - this.startPaneInitialSize}%`
    } else {
      start.style.width = `${this.startPaneInitialSize}%`
      end.style.width = `${100 - this.startPaneInitialSize}%`
    }

    let md;
    const mouseDown = (e) => {
      let touchDetails;
      if (e instanceof TouchEvent) {
        touchDetails = e.changedTouches[0];
      } else {
        touchDetails = e;
      }

      md = {touchDetails,
        offsetLeft: divider.offsetLeft,
        offsetTop: divider.offsetTop,
        firstWidth: start.offsetWidth,
        secondWidth: end.offsetWidth,
        firstHeight: start.offsetHeight,
        secondHeight: end.offsetHeight,
       };
      document.addEventListener('mousemove', mouseMove);
      document.addEventListener('mouseup', mouseUp);
      document.addEventListener('touchmove', mouseMove);
      document.addEventListener('touchend', mouseUp);
    };

    const mouseMove = (e) => {
      let clientX;
      let clientY;
      if (e instanceof TouchEvent) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      
      const delta = {
        x: clientX - md.touchDetails.clientX,
        y: clientY - md.touchDetails.clientY,
      };

      if (this.orientation === 'horizontal') {
          // Prevent negative-sized elements
          delta.x = Math.min(Math.max(delta.x, -md.firstWidth), md.secondWidth);

          divider.style.left = md.offsetLeft + delta.x + "px";
          start.style.width = (md.firstWidth + delta.x) + "px";
          end.style.width = (md.secondWidth - delta.x) + "px";
      } else {
        delta.y = Math.min(Math.max(delta.y, -md.firstHeight), md.secondHeight);

        divider.style.top = md.offsetTop + delta.y + "px";
        start.style.height = (md.firstHeight + delta.y) + "px";
        end.style.height = (md.secondHeight - delta.y) + "px";
      }
    };

    // Clear mouse events on mouseup.
    const mouseUp = () => {
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', mouseUp);
      document.removeEventListener('touchmove', mouseMove);
      document.removeEventListener('touchend', mouseUp);
    }

    divider.addEventListener('mousedown', mouseDown);
    divider.addEventListener('touchstart', mouseDown);
  }
  
  render() {
    return html`
      <div id="root" class="${this.orientation}">
        <div id="start-pane">
          <slot name="start-pane" />
        </div>
        <div id="divider"></div>
        <div id="end-pane">
          <slot name="end-pane" />
        </div>
      </div>`;
  }

  static get properties() {
    return {
      orientation: {type: String},
      startPaneInitialSize: {type: Number},
    };
  }
}

customElements.define('split-pane', SplitPane);
