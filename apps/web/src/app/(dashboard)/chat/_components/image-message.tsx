"use client";

interface ImageMessageProps {
  url: string;
  filename?: string;
  caption?: string;
}

export function ImageMessage({ url, filename, caption }: ImageMessageProps) {
  return (
    <div className="chat-imageMessage">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img
          src={url}
          alt={caption ?? filename ?? "Uploaded image"}
          className="chat-imageMessageImg"
          loading="lazy"
        />
      </a>
      {filename && (
        <div className="chat-imageMessageFilename">{filename}</div>
      )}
      {caption && (
        <div className="chat-imageMessageCaption">{caption}</div>
      )}
    </div>
  );
}
