import type { ReactNode } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvidedDragHandleProps,
  type DropResult,
} from "@hello-pangea/dnd";

export type SortableRenderState = {
  dragHandleProps: DraggableProvidedDragHandleProps | null;
  isDragging: boolean;
};

export function SortableTimeline<T>({
  items,
  itemKey,
  disabled,
  onReorder,
  children,
}: {
  items: T[];
  itemKey: (item: T) => string;
  disabled: boolean;
  onReorder: (items: T[]) => void;
  children: (item: T, index: number, state: SortableRenderState) => ReactNode;
}) {
  const onDragEnd = (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index)
      return;
    const next = [...items];
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    onReorder(next);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="trip-timeline" direction="vertical">
        {(dropProvided) => (
          <section
            className="unified-timeline"
            ref={dropProvided.innerRef}
            {...dropProvided.droppableProps}
          >
            {items.map((item, index) => (
              <Draggable
                draggableId={itemKey(item)}
                index={index}
                isDragDisabled={disabled}
                key={itemKey(item)}
              >
                {(dragProvided, snapshot) => (
                  <div
                    className={`sortable-timeline-item${snapshot.isDragging ? " is-dragging" : ""}`}
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    style={dragProvided.draggableProps.style}
                  >
                    {children(item, index, {
                      dragHandleProps: dragProvided.dragHandleProps,
                      isDragging: snapshot.isDragging,
                    })}
                  </div>
                )}
              </Draggable>
            ))}
            {dropProvided.placeholder}
          </section>
        )}
      </Droppable>
    </DragDropContext>
  );
}
