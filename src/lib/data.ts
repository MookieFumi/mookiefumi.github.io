import { getCollection } from 'astro:content';

// Temas y secciones de recursos en el orden de su fichero YAML.
export async function getTopics() {
  return (await getCollection('topics')).sort((a, b) => a.data.order - b.data.order);
}

export async function getResources() {
  return (await getCollection('resources')).sort((a, b) => a.data.order - b.data.order);
}
