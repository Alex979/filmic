import { elementSource } from "filmic";
import landscapeUrl from "./landscape.svg";
import type { DemoInstance } from "./types";

/** An image (or a dropped image or video file), laid out like object-fit. */
export function mediaDemo(): DemoInstance {
  let element: HTMLImageElement | HTMLVideoElement = loadImage(landscapeUrl);
  let objectUrl: string | null = null;

  const release = () => {
    if (element instanceof HTMLVideoElement) element.pause();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  return {
    source: (fit) => elementSource(element, { fit, background: "#0d0c0b" }),
    drop(file) {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      if (!isImage && !isVideo) return false;
      release();
      objectUrl = URL.createObjectURL(file);
      element = isVideo ? loadVideo(objectUrl) : loadImage(objectUrl);
      return true;
    },
    dispose: release,
  };
}

function loadImage(src: string) {
  const img = new Image();
  img.src = src;
  return img;
}

/** A muted, looping video that plays without being on the page. */
export function loadVideo(src: string) {
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.src = src;
  video.play().catch(() => {}); // rejects if paused before it starts; harmless
  return video;
}
