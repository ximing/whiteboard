import { useModel } from '@umijs/max';
import styles from './index.less';
import { useEffect } from 'react';
import { useService } from '@rsjs/core';
import { BoardService } from '@/services/boardService';
import Konva from 'konva';

export const Board: React.FC = () => {
  const { name } = useModel('global');
  const boardService = useService(BoardService);
  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length > 0) {
        const [entry] = entries;
        boardService.viewPortHeight = entry.contentRect.height;
        boardService.viewPortWidth = entry.contentRect.width;
      }
    });
    const container = document.getElementById('xm-board')! as HTMLDivElement;
    boardService.viewPortHeight = container.clientHeight;
    boardService.viewPortWidth = container.clientWidth;
    resizeObserver.observe(container);
    const stage = new Konva.Stage({
      container,
      width: boardService.viewPortWidth,
      height: boardService.viewPortHeight,
    });
    boardService.stage = stage;

    const layer = new Konva.Layer();
    stage.add(layer);

    let isPaint = false;
    let mode = 'brush';
    let lastLine: any;

    stage.on('mousedown touchstart', function (e) {
      isPaint = true;
      const pos = stage.getPointerPosition()!;
      lastLine = new Konva.Line({
        stroke: '#df4b26',
        strokeWidth: 5,
        globalCompositeOperation:
          mode === 'brush' ? 'source-over' : 'destination-out',
        // round cap for smoother lines
        lineCap: 'round',
        lineJoin: 'round',
        // add point twice, so we have some drawings even on a simple click
        points: [pos.x, pos.y, pos.x, pos.y],
      });
      layer.add(lastLine);
    });

    stage.on('mouseup touchend', function () {
      isPaint = false;
    });

    // and core function - drawing
    stage.on('mousemove touchmove', function (e) {
      if (!isPaint) {
        return;
      }
      // prevent scrolling on touch devices
      e.evt.preventDefault();
      const pos = stage.getPointerPosition()!;
      var newPoints = lastLine.points().concat([pos.x, pos.y]);
      lastLine.points(newPoints);
    });
  }, []);
  return (
    <div id="xm-board" className={styles.board}>
      123
    </div>
  );
};
