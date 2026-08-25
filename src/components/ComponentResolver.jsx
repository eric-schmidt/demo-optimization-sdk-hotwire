import chalk from "chalk";
import React from "react";
import { ComponentMap } from "@/src/components/ComponentMap";

// Server-rendered resolver used on the published path. No Live Preview
// subscription — data comes from the cached Delivery API fetch. Because this
// module has no "use client" directive and imports leaves that also have none,
// nothing from this render path ships to the client bundle.
export const ComponentResolver = ({ entry }) => {
  const contentTypeId = entry.sys.contentType.sys.id;
  const Component = ComponentMap[contentTypeId];

  if (!Component) {
    console.log(chalk.red(`No Mapping for: ${contentTypeId}`));
    return null;
  }

  return <Component fields={entry.fields} contentTypeId={contentTypeId} />;
};
