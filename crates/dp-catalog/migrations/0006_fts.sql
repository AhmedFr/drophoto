CREATE VIRTUAL TABLE media_fts USING fts5(
    stem, tags, place, camera,
    tokenize = 'unicode61 remove_diacritics 2'
);
