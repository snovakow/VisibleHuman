import { useEffect, useRef, useState } from 'react'
import { importExtensions, provideImportPicker } from '../motion/import.ts'
import { useStore } from '../store.ts'

// The page as a drop target for a clip's file, and the file input the Motion folder's Import opens: a GLB, FBX or BVH
// file dropped anywhere on the page, or chosen, is read and played at once. While a file is dragged over the page, a
// line in the middle of it says what dropping it does

const holdsFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true

export function MotionDrop() {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    provideImportPicker(() => input.current?.click())
    const dragOver = (event: DragEvent) => {
      if (!holdsFiles(event)) return
      // Taken, so the browser drops the file here rather than opening it in place of the page
      event.preventDefault()
      setOver(true)
    }
    // A drag leaving the window leaves for nothing; one leaving an element for another stays on the page
    const dragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setOver(false)
    }
    const drop = (event: DragEvent) => {
      if (!holdsFiles(event)) return
      event.preventDefault()
      setOver(false)
      const file = event.dataTransfer?.files[0]
      if (file) useStore.getState().importMotion(file)
    }
    window.addEventListener('dragover', dragOver)
    window.addEventListener('dragleave', dragLeave)
    window.addEventListener('drop', drop)
    return () => {
      provideImportPicker(null)
      window.removeEventListener('dragover', dragOver)
      window.removeEventListener('dragleave', dragLeave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return (
    <>
      <input
        ref={input}
        className="motion-import"
        type="file"
        accept={importExtensions.join(',')}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Emptied, so that choosing the same file again reads it again
          event.target.value = ''
          if (file) useStore.getState().importMotion(file)
        }}
      />
      {over ? <div className="drop-hint">Drop a GLB, FBX or BVH clip to play it on the body</div> : null}
    </>
  )
}
