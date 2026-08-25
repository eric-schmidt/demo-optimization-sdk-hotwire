"use client";

import React from "react";
import { useContentfulLiveUpdates } from "@contentful/live-preview/react";
import { ComponentMap } from "@/src/components/ComponentMap";

// Client-side resolver used on the draft path. Subscribes to Live Preview
// once per entry and passes the updated fields down to the mapped component.
// Only imported from routes that have already checked draftMode(); the
// published path uses <ComponentResolver> and ships no Live Preview JS.
export const LivePreviewResolver = ({ entry }) => {
  const liveEntry = useContentfulLiveUpdates(entry);

  const contentTypeId = entry.sys.contentType.sys.id;
  const Component = ComponentMap[contentTypeId];

  if (!Component) {
    return null;
  }

  return <Component fields={liveEntry.fields} contentTypeId={contentTypeId} />;
};
