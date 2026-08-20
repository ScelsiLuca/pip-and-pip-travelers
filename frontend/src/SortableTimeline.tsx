import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

export {
  DragDropContext,
  Droppable,
  Draggable,
};

export type {
  DropResult,
  DraggableProvidedDragHandleProps,
};

export function SortableDroppable<T>({
  droppableId,
  items,
  itemKey,
  disabled,
  className = "unified-timeline",
  children,
}: {
  droppableId: string;
  items: T[];
  itemKey: (item: T) => string;
  disabled: boolean;
  className?: string;
  children: (
    item: T,
    index: number,
    state: SortableRenderState,
  ) => ReactNode;
}) {
  return (
    <Droppable
      droppableId={droppableId}
      direction="vertical"
    >
      {(dropProvided) => (
        <section
          className={className}
          ref={dropProvided.innerRef}
          {...dropProvided.droppableProps}
        >
          {items.map((item, index) => (
            <Draggable
              draggableId={itemKey(item)}
              index={index}
              isDragDisabled={disabled}
              disableInteractiveElementBlocking
              key={itemKey(item)}
            >
              {(dragProvided, snapshot) => (
                <div
                  className={`sortable-timeline-item${
                    snapshot.isDragging
                      ? " is-dragging"
                      : ""
                  }`}
                  ref={dragProvided.innerRef}
                  {...dragProvided.draggableProps}
                  style={{
                    ...dragProvided.draggableProps.style,
                    ...(snapshot.isDropAnimating
                      ? { transitionDuration: "0.04s" }
                      : {}),
                  }}
                >
                  {children(
                    item,
                    index,
                    {
                      dragHandleProps:
                        dragProvided.dragHandleProps,
                      isDragging:
                        snapshot.isDragging,
                    },
                  )}
                </div>
              )}
            </Draggable>
          ))}

          {dropProvided.placeholder}
        </section>
      )}
    </Droppable>
  );
}

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
  onReorder: (items: T[]) => void | Promise<void>;
  children: (
    item: T,
    index: number,
    state: SortableRenderState,
  ) => ReactNode;
}) {
  const [orderedItems, setOrderedItems] =
    useState<T[]>(items);

  const savingReorder = useRef(false);

  useEffect(() => {
    if (savingReorder.current) {
      return;
    }

    setOrderedItems(items);
  }, [items]);

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) {
      setOrderedItems(items);
      return;
    }

    if (
      result.source.index ===
      result.destination.index
    ) {
      return;
    }

    const previous = [...orderedItems];
    const next = [...orderedItems];

    const [moved] = next.splice(
      result.source.index,
      1,
    );

    next.splice(
      result.destination.index,
      0,
      moved,
    );

    setOrderedItems(next);

    savingReorder.current = true;

    Promise.resolve(onReorder(next))
      .then(() => {
        window.setTimeout(() => {
          savingReorder.current = false;
        }, 150);
      })
      .catch(() => {
        savingReorder.current = false;
        setOrderedItems(previous);
      });
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <SortableDroppable
        droppableId="trip-timeline"
        items={orderedItems}
        itemKey={itemKey}
        disabled={disabled}
      >
        {children}
      </SortableDroppable>
    </DragDropContext>
  );
}
