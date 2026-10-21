export function resourceDownloadURL(resource, useRevision = false) {
  const url = new URL(resource.url);
  if (url.protocol !== 'https:' || url.hostname !== 'ckan0.cf.opendata.inter.prod-toronto.ca') {
    throw new Error('Unexpected official source URL');
  }
  if (useRevision) {
    const revision = String(resource.last_modified || '').replace(/[^0-9T-]/g, '');
    if (!revision) throw new Error('A source revision is required for a cache retry');
    url.searchParams.set('eventmap_revision', revision);
  }
  return url.href;
}

export function shouldRetryRevision(error, sourceURL) {
  return error.sourceURL === sourceURL && [502, 503, 504].includes(error.status);
}
