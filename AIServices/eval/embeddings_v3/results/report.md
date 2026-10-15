# Benchmark v3 — ESCO phrase / knowledge skills

Model: `BAAI/bge-small-en-v1.5` · 153 pairs · user side "Name: curated description"

## All pairs

| Option | Split | n | AUC | AUC vs hard | Thr@P95 | Recall@P95 | at dev thr (P / R) | at 0.73 (P / R) |
|---|---|---|---|---|---|---|---|---|
| a (label only) | dev | 107 | 0.9893 | 0.9877 | 0.612 | 0.944 | — | 1.0 / 0.667 |
| a (label only) | heldout | 46 | 0.9871 | 0.9853 | 0.6305 | 0.968 | 0.968 / 0.968 | 1.0 / 0.742 |
| b (label: first sentence (<=25 words)) | dev | 107 | 0.979 | 0.9717 | 0.6134 | 0.903 | — | 1.0 / 0.597 |
| b (label: first sentence (<=25 words)) | heldout | 46 | 0.9269 | 0.9032 | 0.6739 | 0.71 | 0.906 / 0.935 | 1.0 / 0.484 |
| c (label: full description (<=60 words)) | dev | 107 | 0.9778 | 0.9701 | 0.5866 | 0.931 | — | 1.0 / 0.319 |
| c (label: full description (<=60 words)) | heldout | 46 | 0.9204 | 0.8915 | 0.6722 | 0.613 | 0.935 / 0.935 | 1.0 / 0.355 |

## Sensitivity: without pairs whose ESCO description names the user skill

| Option | Split | n | AUC | AUC vs hard | Thr@P95 | Recall@P95 | at dev thr (P / R) | at 0.73 (P / R) |
|---|---|---|---|---|---|---|---|---|
| a (label only) | dev | 96 | 0.9874 | 0.9855 | 0.612 | 0.934 | — | 1.0 / 0.607 |
| a (label only) | heldout | 42 | 0.9852 | 0.9832 | 0.6305 | 0.963 | 0.963 / 0.963 | 1.0 / 0.704 |
| b (label: first sentence (<=25 words)) | dev | 96 | 0.9752 | 0.9666 | 0.6205 | 0.885 | — | 1.0 / 0.557 |
| b (label: first sentence (<=25 words)) | heldout | 42 | 0.9185 | 0.8923 | 0.7207 | 0.519 | 0.889 / 0.889 | 1.0 / 0.481 |
| c (label: full description (<=60 words)) | dev | 96 | 0.9738 | 0.9647 | 0.6116 | 0.869 | — | 1.0 / 0.311 |
| c (label: full description (<=60 words)) | heldout | 42 | 0.916 | 0.8855 | 0.7207 | 0.407 | 0.923 / 0.889 | 1.0 / 0.37 |

## Score distributions (all pairs, both splits)

| Option | Label | n | mean | min | p25 | median | p75 | max |
|---|---|---|---|---|---|---|---|---|
| a | 2 | 51 | 0.785 | 0.579 | 0.748 | 0.791 | 0.834 | 0.874 |
| a | 1 | 52 | 0.728 | 0.561 | 0.701 | 0.739 | 0.78 | 0.837 |
| a | 0 hard | 37 | 0.547 | 0.434 | 0.52 | 0.544 | 0.58 | 0.632 |
| a | 0 easy | 13 | 0.504 | 0.43 | 0.474 | 0.487 | 0.544 | 0.612 |
| b | 2 | 51 | 0.761 | 0.621 | 0.724 | 0.755 | 0.806 | 0.893 |
| b | 1 | 52 | 0.696 | 0.514 | 0.649 | 0.688 | 0.764 | 0.835 |
| b | 0 hard | 37 | 0.55 | 0.453 | 0.51 | 0.534 | 0.597 | 0.716 |
| b | 0 easy | 13 | 0.478 | 0.346 | 0.447 | 0.49 | 0.512 | 0.58 |
| c | 2 | 51 | 0.736 | 0.526 | 0.7 | 0.728 | 0.78 | 0.893 |
| c | 1 | 52 | 0.665 | 0.512 | 0.622 | 0.658 | 0.706 | 0.821 |
| c | 0 hard | 37 | 0.525 | 0.435 | 0.476 | 0.512 | 0.543 | 0.716 |
| c | 0 easy | 13 | 0.453 | 0.354 | 0.443 | 0.453 | 0.49 | 0.526 |

## Decision

```
{
  "dev_auc_hard": {
    "a": 0.9877,
    "b": 0.9717,
    "c": 0.9701
  },
  "tied_within_0.01": [
    "a"
  ],
  "chosen": "a",
  "chosen_dev_threshold": 0.612,
  "heldout_auc_hard": {
    "a": 0.9853,
    "b": 0.9032,
    "c": 0.8915
  },
  "heldout_gain_vs_a": 0.0,
  "heldout_gain_vs_a_95ci": [
    0.0,
    0.0
  ],
  "heldout_recall_p95": 0.968,
  "heldout_at_dev_threshold": {
    "threshold": 0.612,
    "precision": 0.968,
    "recall": 0.968
  },
  "guardrail_passed": false,
  "outcome": "keep the single 0.73 threshold and label-only ESCO text (guardrail not met)"
}
```

## mutual_nn against the role-skill index

For each related pair, the user is just that skill, so mutual_nn reduces to: the ESCO skill is among the user skill's 10 nearest role skills (1,428-skill index rebuilt with the option's ESCO text). Threshold = the option's dev Thr@P95.

- **a**: related pairs in the index 103 (not in index 0); above threshold 98; above threshold **and** mutual 34. Lost by mutual: SQL -> use query languages (0.786), SQL -> manage database (0.685), Metasploit -> perform ICT security testing (0.750), Kali Linux -> ethical hacking principles (0.647), Penetration Testing -> identify ICT system weaknesses (0.694), Pandas -> perform data cleansing (0.677), Power BI -> deliver visual presentation of data (0.707), AWS -> develop with cloud services (0.762), Microsoft Azure -> deploy cloud resource (0.746), Terraform -> automate cloud tasks (0.796)
- **b**: related pairs in the index 103 (not in index 0); above threshold 94; above threshold **and** mutual 20. Lost by mutual: Figma -> design user interface (0.740), SQL -> use query languages (0.793), SQL -> manage database (0.737), PostgreSQL -> database management systems (0.820), Selenium -> tools for ICT test automation (0.810), Git -> tools for software configuration management (0.690), Wireshark -> implement ICT network diagnostic tools (0.662), Metasploit -> perform ICT security testing (0.674), Kali Linux -> ethical hacking principles (0.621), Penetration Testing -> identify ICT system weaknesses (0.750)
- **c**: related pairs in the index 103 (not in index 0); above threshold 96; above threshold **and** mutual 16. Lost by mutual: Figma -> design user interface (0.719), SQL -> use query languages (0.793), SQL -> manage database (0.737), PostgreSQL -> database management systems (0.820), Selenium -> tools for ICT test automation (0.810), Git -> tools for software configuration management (0.690), Wireshark -> implement ICT network diagnostic tools (0.664), Metasploit -> perform ICT security testing (0.684), Penetration Testing -> identify ICT system weaknesses (0.727), Pandas -> perform data cleansing (0.666)

## 15 worst pairs per option (relative to the option's dev Thr@P95)

### Option a

| id | user skill | ESCO skill | label | split | similarity | error |
|---|---|---|---|---|---|---|
| p075 | Bash | administer ICT system | 1 | heldout | 0.5607 | 0.0513 |
| p097 | REST APIs | interfacing techniques | 1 | dev | 0.5727 | 0.0393 |
| p014 | Jira | use ICT ticketing system | 2 | dev | 0.579 | 0.033 |
| p125 | Kotlin | perform data mining | 0 hard | dev | 0.6316 | 0.0196 |
| p108 | Docker | design graphics | 0 hard | heldout | 0.6305 | 0.0185 |
| p105 | React | perform data mining | 0 hard | dev | 0.6195 | 0.0075 |
| p074 | Linux | administer ICT system | 1 | dev | 0.6066 | 0.0054 |
| p096 | REST APIs | use an application-specific interface | 1 | dev | 0.6086 | 0.0034 |
| p152 | Selenium | work safely with machines | 0 easy | dev | 0.612 | -0.0 |
| p106 | Pandas | design user interface | 0 hard | dev | 0.6111 | -0.0009 |
| p052 | Figma | create website wireframe | 1 | dev | 0.6165 | -0.0045 |
| p120 | Terraform | measure software usability | 0 hard | dev | 0.607 | -0.005 |
| p111 | Python | ICT network routing | 0 hard | heldout | 0.6062 | -0.0058 |
| p117 | Git | perform data mining | 0 hard | heldout | 0.5999 | -0.0121 |
| p102 | Scrum | perform project management | 1 | dev | 0.6322 | -0.0202 |

### Option b

| id | user skill | ESCO skill | label | split | similarity | error |
|---|---|---|---|---|---|---|
| p111 | Python | ICT network routing | 0 hard | heldout | 0.7158 | 0.1024 |
| p075 | Bash | administer ICT system | 1 | heldout | 0.5136 | 0.0998 |
| p062 | TensorFlow | principles of artificial intelligence | 1 | dev | 0.5342 | 0.0792 |
| p052 | Figma | create website wireframe | 1 | dev | 0.5539 | 0.0595 |
| p102 | Scrum | perform project management | 1 | dev | 0.5549 | 0.0585 |
| p124 | Swift | ICT network routing | 0 hard | heldout | 0.6718 | 0.0584 |
| p108 | Docker | design graphics | 0 hard | heldout | 0.6496 | 0.0362 |
| p105 | React | perform data mining | 0 hard | dev | 0.6429 | 0.0295 |
| p074 | Linux | administer ICT system | 1 | dev | 0.5855 | 0.0279 |
| p125 | Kotlin | perform data mining | 0 hard | dev | 0.6411 | 0.0277 |
| p081 | Tableau | perform data analysis | 1 | dev | 0.6043 | 0.0091 |
| p067 | Postman | execute integration testing | 1 | dev | 0.606 | 0.0074 |
| p083 | Excel | perform data analysis | 1 | dev | 0.6062 | 0.0072 |
| p064 | Jenkins | tools for software configuration management | 1 | heldout | 0.6108 | 0.0026 |
| p120 | Terraform | measure software usability | 0 hard | dev | 0.6134 | -0.0 |

### Option c

| id | user skill | ESCO skill | label | split | similarity | error |
|---|---|---|---|---|---|---|
| p111 | Python | ICT network routing | 0 hard | heldout | 0.7158 | 0.1292 |
| p124 | Swift | ICT network routing | 0 hard | heldout | 0.6718 | 0.0852 |
| p075 | Bash | administer ICT system | 1 | heldout | 0.5116 | 0.075 |
| p009 | Kali Linux | ethical hacking principles | 2 | heldout | 0.5256 | 0.061 |
| p105 | React | perform data mining | 0 hard | dev | 0.6429 | 0.0563 |
| p125 | Kotlin | perform data mining | 0 hard | dev | 0.6411 | 0.0545 |
| p062 | TensorFlow | principles of artificial intelligence | 1 | dev | 0.5342 | 0.0524 |
| p095 | Kafka | inter-organisational middleware system | 1 | dev | 0.5375 | 0.0491 |
| p067 | Postman | execute integration testing | 1 | dev | 0.5441 | 0.0425 |
| p052 | Figma | create website wireframe | 1 | dev | 0.5465 | 0.0401 |
| p102 | Scrum | perform project management | 1 | dev | 0.553 | 0.0336 |
| p109 | SQL | create 3D characters | 0 hard | dev | 0.603 | 0.0164 |
| p074 | Linux | administer ICT system | 1 | dev | 0.5866 | -0.0 |
| p093 | Microservices | software architecture models | 1 | dev | 0.5881 | -0.0015 |
| p094 | MongoDB | unstructured data | 1 | dev | 0.5887 | -0.0021 |

