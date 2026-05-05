(function attachCollectionHelpers(globalScope) {
  function flattenCollections(libraries) {
    const entries = new Map();
    const visit = node => {
      entries.set(node.collectionID, node);
      node.children.forEach(visit);
    };

    libraries.forEach(library => library.children.forEach(visit));
    return entries;
  }

  function countSubcollections(node) {
    return node.children.reduce((total, child) => total + 1 + countSubcollections(child), 0);
  }

  function normalizeFilterValue(value) {
    return String(value || "").trim().toLocaleLowerCase();
  }

  function filterNodes(nodes, query) {
    const filtered = [];

    for (const node of nodes) {
      if (node.name.toLocaleLowerCase().includes(query)) {
        filtered.push(node);
        continue;
      }

      const filteredChildren = filterNodes(node.children, query);
      if (filteredChildren.length) {
        filtered.push({
          ...node,
          children: filteredChildren,
        });
      }
    }

    return filtered;
  }

  function filterLibraries(libraries, rawQuery) {
    const query = normalizeFilterValue(rawQuery);
    if (!query) {
      return libraries;
    }

    const filtered = [];
    for (const library of libraries) {
      const children = filterNodes(library.children, query);
      if (children.length) {
        filtered.push({
          ...library,
          children,
        });
      }
    }

    return filtered;
  }

  const api = {
    flattenCollections,
    countSubcollections,
    filterLibraries,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.zotExportCollections = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : undefined);