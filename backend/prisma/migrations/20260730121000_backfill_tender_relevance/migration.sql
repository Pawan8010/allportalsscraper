UPDATE "Tender"
SET "relevance" = CASE
  WHEN concat_ws(' ', title, category) ~* '(spares?|spare[[:space:]]*parts?|components?|accessor(y|ies)|repair(ing)?[[:space:]]+of|amc|annual[[:space:]]+maintenance|refurbishment?|overhaul|calibration|replacement[[:space:]]+of|maintenance[[:space:]]+of|servicing[[:space:]]+of)'
    THEN 'irrelevant'
  WHEN concat_ws(' ', organisation, department) ~* '(army|navy|naval|air[[:space:]]*force|defence|defense|drdo|ordnance|military|para[[:space:]]*military|border[[:space:]]*security|bsf|crpf|itbp|ssb|cisf|nsg|coast[[:space:]]*guard|railway[[:space:]]*protection|surveillance|intelligence[[:space:]]*bureau|home[[:space:]]*affairs)'
    THEN 'relevant'
  WHEN concat_ws(' ', organisation, department) ~* '(college|university|school|polytechnic|panchayat|municipal|municipality|hospital|medical[[:space:]]+college|agricultur|horticultur)'
    THEN 'irrelevant'
  ELSE 'unclassified'
END
WHERE "relevance" IS NULL;
