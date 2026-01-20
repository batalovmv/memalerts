# Query Analysis (EXPLAIN)

Mode: EXPLAIN (no analyze)
Generated: 2026-01-18T16:25:34.309Z

## Streamer moderation pending submissions

SQL:
```sql
SELECT * FROM "MemeSubmission" WHERE "channelId" = $1 AND "status" = $2 ORDER BY "createdAt" DESC, "id" DESC LIMIT 51
```

Params:
```json
[
  "3c144179-97fa-4a08-8f32-3adf939d18e3",
  "pending"
]
```

Plan:
```json
[
  {
    "QUERY PLAN": [
      {
        "Plan": {
          "Node Type": "Limit",
          "Parallel Aware": false,
          "Async Capable": false,
          "Startup Cost": 8.17,
          "Total Cost": 8.22,
          "Plan Rows": 2,
          "Plan Width": 2016,
          "Plans": [
            {
              "Node Type": "Incremental Sort",
              "Parent Relationship": "Outer",
              "Parallel Aware": false,
              "Async Capable": false,
              "Startup Cost": 8.17,
              "Total Cost": 8.22,
              "Plan Rows": 2,
              "Plan Width": 2016,
              "Sort Key": [
                "\"createdAt\" DESC",
                "id DESC"
              ],
              "Presorted Key": [
                "\"createdAt\""
              ],
              "Plans": [
                {
                  "Node Type": "Index Scan",
                  "Parent Relationship": "Outer",
                  "Parallel Aware": false,
                  "Async Capable": false,
                  "Scan Direction": "Forward",
                  "Index Name": "MemeSubmission_channelId_status_createdAt_desc_idx",
                  "Relation Name": "MemeSubmission",
                  "Alias": "MemeSubmission",
                  "Startup Cost": 0.14,
                  "Total Cost": 8.16,
                  "Plan Rows": 1,
                  "Plan Width": 2016,
                  "Index Cond": "((\"channelId\" = '3c144179-97fa-4a08-8f32-3adf939d18e3'::text) AND (status = 'pending'::text))"
                }
              ]
            }
          ]
        }
      }
    ]
  }
]
```

## Viewer submissions list

SQL:
```sql
SELECT * FROM "MemeSubmission" WHERE "submitterUserId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT 51
```

Params:
```json
[
  "e227ef8d-5a17-4b67-a959-0d69565397b2"
]
```

Plan:
```json
[
  {
    "QUERY PLAN": [
      {
        "Plan": {
          "Node Type": "Limit",
          "Parallel Aware": false,
          "Async Capable": false,
          "Startup Cost": 13.14,
          "Total Cost": 13.26,
          "Plan Rows": 47,
          "Plan Width": 2016,
          "Plans": [
            {
              "Node Type": "Sort",
              "Parent Relationship": "Outer",
              "Parallel Aware": false,
              "Async Capable": false,
              "Startup Cost": 13.14,
              "Total Cost": 13.26,
              "Plan Rows": 47,
              "Plan Width": 2016,
              "Sort Key": [
                "\"createdAt\" DESC",
                "id DESC"
              ],
              "Plans": [
                {
                  "Node Type": "Seq Scan",
                  "Parent Relationship": "Outer",
                  "Parallel Aware": false,
                  "Async Capable": false,
                  "Relation Name": "MemeSubmission",
                  "Alias": "MemeSubmission",
                  "Startup Cost": 0,
                  "Total Cost": 11.84,
                  "Plan Rows": 47,
                  "Plan Width": 2016,
                  "Filter": "(\"submitterUserId\" = 'e227ef8d-5a17-4b67-a959-0d69565397b2'::text)"
                }
              ]
            }
          ]
        }
      }
    ]
  }
]
```

## Channel meme library (approved)

SQL:
```sql
SELECT * FROM "ChannelMeme" WHERE "channelId" = $1 AND "status" = $2 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC, "id" DESC LIMIT 51
```

Params:
```json
[
  "3c144179-97fa-4a08-8f32-3adf939d18e3",
  "approved"
]
```

Plan:
```json
[
  {
    "QUERY PLAN": [
      {
        "Plan": {
          "Node Type": "Limit",
          "Parallel Aware": false,
          "Async Capable": false,
          "Startup Cost": 9.63,
          "Total Cost": 9.72,
          "Plan Rows": 35,
          "Plan Width": 1081,
          "Plans": [
            {
              "Node Type": "Sort",
              "Parent Relationship": "Outer",
              "Parallel Aware": false,
              "Async Capable": false,
              "Startup Cost": 9.63,
              "Total Cost": 9.72,
              "Plan Rows": 35,
              "Plan Width": 1081,
              "Sort Key": [
                "\"createdAt\" DESC",
                "id DESC"
              ],
              "Plans": [
                {
                  "Node Type": "Seq Scan",
                  "Parent Relationship": "Outer",
                  "Parallel Aware": false,
                  "Async Capable": false,
                  "Relation Name": "ChannelMeme",
                  "Alias": "ChannelMeme",
                  "Startup Cost": 0,
                  "Total Cost": 8.73,
                  "Plan Rows": 35,
                  "Plan Width": 1081,
                  "Filter": "((\"deletedAt\" IS NULL) AND (\"channelId\" = '3c144179-97fa-4a08-8f32-3adf939d18e3'::text) AND (status = 'approved'::text))"
                }
              ]
            }
          ]
        }
      }
    ]
  }
]
```
