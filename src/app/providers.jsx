"use client";

import React from "react";
import { ContentfulLivePreviewProvider } from "@contentful/live-preview/react";

export const Providers = ({ children }) => {
  return (
    <ContentfulLivePreviewProvider
      locale="en-US"
      enableInspectorMode={true}
      enableLiveUpdates={true}
    >
      {children}
    </ContentfulLivePreviewProvider>
  );
};
