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

    /*
     * Aggiorniamo subito la UI.
     * In questo modo il drop non deve aspettare
     * la risposta del backend.
     */
    setOrderedItems(next);

    savingReorder.current = true;

    Promise.resolve(onReorder(next))
      .then(() => {
        /*
         * Lasciamo terminare completamente
         * l'animazione di drop prima di permettere
         * al parent di risincronizzare la lista.
         */
        window.setTimeout(() => {
          savingReorder.current = false;
        }, 150);
      })
      .catch(() => {
        savingReorder.current = false;

        /*
         * Se il backend fallisce,
         * torniamo all'ordine precedente.
         */
        setOrderedItems(previous);
      });
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable
        droppableId="trip-timeline"
        direction="vertical"
      >
        {(dropProvided) => (
          <section
            className="unified-timeline"
            ref={dropProvided.innerRef}
            {...dropProvided.droppableProps}
          >
            {orderedItems.map(
              (item, index) => (
                <Draggable
                  draggableId={itemKey(item)}
                  index={index}
                  isDragDisabled={disabled}
                  disableInteractiveElementBlocking
                  key={itemKey(item)}
                >
                  {(
                    dragProvided,
                    snapshot,
                  ) => (
                    <div
                      className={`sortable-timeline-item${
                        snapshot.isDragging
                          ? " is-dragging"
                          : ""
                      }`}
                      ref={
                        dragProvided.innerRef
                      }
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
              ),
            )}

            {dropProvided.placeholder}
          </section>
        )}
      </Droppable>
    </DragDropContext>
  );
}