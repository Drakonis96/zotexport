const assert = require("node:assert/strict");
const test = require("node:test");

const {
  countSubcollections,
  filterLibraries,
  flattenCollections,
} = require("../src/renderer/collections");

function createLibrariesFixture() {
  return [
    {
      id: "library-1",
      libraryID: 1,
      name: "My Library",
      children: [
        {
          collectionID: 10,
          libraryID: 1,
          name: "Alpha Root",
          children: [
            {
              collectionID: 11,
              libraryID: 1,
              name: "Child Notes",
              children: [
                {
                  collectionID: 12,
                  libraryID: 1,
                  name: "Grandchild PDFs",
                  children: [],
                },
              ],
            },
          ],
        },
        {
          collectionID: 20,
          libraryID: 1,
          name: "Reference Shelf",
          children: [],
        },
      ],
    },
  ];
}

test("filterLibraries keeps ancestor context for descendant matches", () => {
  const libraries = createLibrariesFixture();
  const filtered = filterLibraries(libraries, "grandchild");

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].children.length, 1);
  assert.equal(filtered[0].children[0].name, "Alpha Root");
  assert.equal(filtered[0].children[0].children.length, 1);
  assert.equal(filtered[0].children[0].children[0].name, "Child Notes");
  assert.equal(filtered[0].children[0].children[0].children.length, 1);
  assert.equal(filtered[0].children[0].children[0].children[0].name, "Grandchild PDFs");
});

test("filterLibraries preserves the full subtree when a parent collection matches", () => {
  const libraries = createLibrariesFixture();
  const filtered = filterLibraries(libraries, "alpha");

  assert.equal(filtered[0].children.length, 1);
  assert.equal(filtered[0].children[0].name, "Alpha Root");
  assert.equal(filtered[0].children[0].children.length, 1);
  assert.equal(filtered[0].children[0].children[0].name, "Child Notes");
  assert.equal(filtered[0].children[0].children[0].children.length, 1);
});

test("countSubcollections and flattenCollections summarize the collection tree", () => {
  const libraries = createLibrariesFixture();
  const rootNode = libraries[0].children[0];
  const flattened = flattenCollections(libraries);

  assert.equal(countSubcollections(rootNode), 2);
  assert.equal(flattened.size, 4);
  assert.equal(flattened.get(12)?.name, "Grandchild PDFs");
});