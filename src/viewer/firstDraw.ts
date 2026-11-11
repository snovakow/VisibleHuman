import type { Object3D } from 'three'
import { useStore } from '../store.ts'
import type { Volume } from '../volume/format.ts'

// Tells the store when an object first draws a body's volume, from three's call after it draws the object, which a
// hidden object never gets
export function reportFirstDraw(object: Object3D, volume: Volume) {
  let reported = false
  object.onAfterRender = () => {
    if (reported) return
    reported = true
    useStore.getState().drawn(volume)
  }
}
