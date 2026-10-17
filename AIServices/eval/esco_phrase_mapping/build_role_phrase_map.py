#!/usr/bin/env python
"""
Module 5.1 — role-aware phrase → skill mapping (sandbox, AI-assisted).

Builds role_phrase_skill_map.json: for every (active ESCO role, undescribed essential phrase) pair, 0–8 skills from the
existing skill vocabulary (curated canonical names, app/data/skill_descriptions.json) whose use clearly demonstrates
that ability in that role. The mapping below was written by the assistant (Claude) from the phrase, the role title and
the vocabulary only — no eval profile file was opened — and is conservative: generic, soft, legal, managerial, artistic
and knowledge-only phrases stay empty, and anything doubtful is left out.

Two layers:
- DEFAULT[phrase] — used for every role that has the phrase (the phrase means the same thing everywhere);
- ROLE[role][phrase] — a role-specific list that replaces the default (e.g. "computer programming" → Kotlin / Swift for
  mobile roles, Python / R for data roles); an empty list there forces "no mapping" for that role.
Every name is validated against the vocabulary (the build fails on an unknown name). Pairs not listed stay empty.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/build_role_phrase_map.py
"""

import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402
from app.services.embeddings.descriptions import get_description_provider  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.professions.role_skills import current_skill  # noqa: E402

OUT = HERE / "role_phrase_skill_map.json"

# ── defaults: phrase → (skills, reason) ───────────────────────────────────────
DEFAULT = {
    # programming and tooling
    "ICT system programming": (["C", "C++", "Rust", "Go", "Assembly Language"], "systems programming languages"),
    "use scripting programming": (["Bash", "PowerShell", "Python", "Perl", "Ruby", "Lua"], "scripting languages"),
    "web programming": (["JavaScript", "TypeScript", "PHP", "Node.js", "ASP.NET Core", "Ruby on Rails", "Django"],
                        "web programming languages and server-side web frameworks"),
    "integrated development environment software": (["Visual Studio", "Visual Studio Code", "IntelliJ IDEA", "Eclipse", "PyCharm",
                                                     "Xcode", "Android Studio"], "IDEs"),
    "tools for software configuration management": (["Git", "Subversion", "GitHub", "GitLab", "Bitbucket"],
                                                    "version control / software configuration management tools"),
    "ICT debugging tools": (["Debugging"], "debugging practice"),
    "debug software": (["Debugging"], "the named skill itself"),
    "use software design patterns": (["Design Patterns"], "the named skill itself"),
    "create flowchart diagram": (["Microsoft Visio"], "diagramming tool used for flowcharts"),
    "unified modelling language": (["UML"], "the named skill itself"),
    "object-oriented modelling": (["UML"], "UML is the standard object-oriented modelling notation"),
    "web services": (["REST APIs", "GraphQL", "gRPC", "SoapUI", "OpenAPI"], "web-service technologies"),
    "software frameworks": (["Spring Boot", "Django", "Flask", "Express.js", "ASP.NET Core", "FastAPI", "Ruby on Rails", ".NET"],
                            "application frameworks"),
    "use interface description language": (["OpenAPI", "Swagger", "gRPC"], "interface description languages / tooling"),
    "service-oriented modelling": (["Microservices"], "service-oriented architecture style"),
    "systems development life-cycle": (["Agile", "Waterfall", "Scrum"], "SDLC models"),
    "software design methodologies": (["Agile", "Scrum", "Waterfall", "Kanban"], "software development methodologies"),
    "task algorithmisation": (["Algorithms", "Data Structures and Algorithms"], "algorithm design"),
    "operate open source software": (["Linux", "Git", "GitHub"], "core open-source tooling and its models"),
    "conduct ICT code review": (["Code Review", "SonarQube"], "code review practice and tooling"),
    "software metrics": (["SonarQube"], "code-metrics tool"),
    "manage software releases": (["CI/CD", "Jenkins", "GitHub Actions", "GitLab CI", "Azure DevOps"], "release pipelines"),
    "utilise regular expressions": (["Regular Expressions"], "the named skill itself"),
    "use markup languages": (["HTML", "XML"], "markup languages"),
    "style sheet languages": (["CSS", "Sass", "Less"], "style sheet languages"),
    "JavaScript Framework": (["React", "Angular", "Vue.js", "Svelte", "Next.js", "Nuxt.js", "Ember.js", "jQuery"],
                             "JavaScript frameworks"),
    "implement front-end website design": (["HTML", "CSS", "JavaScript", "React", "Angular", "Vue.js", "Bootstrap", "Tailwind CSS"],
                                           "front-end languages and frameworks"),
    "maintain responsive design": (["Responsive Design", "Bootstrap", "Tailwind CSS"], "responsive design and CSS frameworks"),
    "World Wide Web Consortium standards": (["HTML", "CSS", "Web Accessibility"], "W3C standards (HTML, CSS, WCAG)"),
    "ICT accessibility standards": (["Web Accessibility"], "WCAG / accessibility standards"),
    "test system accessibility for users with special needs": (["Accessibility Testing", "Web Accessibility"],
                                                               "accessibility testing"),
    "proxy servers": (["Nginx"], "reverse/forward proxy server"),
    "decentralized application frameworks": (["Truffle", "Hardhat", "Web3.js", "Ethers.js"], "dApp frameworks"),
    "smart contract programming languages": (["Solidity", "Vyper"], "smart contract languages"),
    "smart contract": (["Smart Contracts", "Solidity", "Vyper"], "smart contracts and their languages"),
    "implement smart contracts": (["Smart Contracts", "Solidity", "Vyper", "Hardhat", "Truffle"], "smart contract development"),
    "blockchain platforms": (["Ethereum", "Hyperledger Fabric"], "blockchain platforms"),
    "distributed ledger technology": (["Blockchain", "Ethereum", "Hyperledger Fabric"], "distributed ledger technologies"),
    "develop blockchain technology": (["Blockchain", "Solidity", "Ethereum", "Hyperledger Fabric"], "blockchain development"),
    "implement cryptographic constructs": (["Cryptography"], "the named skill itself"),
    "blockchain signature schemes": (["Cryptography"], "signature schemes are cryptography"),
    # cloud
    "cloud technologies": (["AWS", "Microsoft Azure", "Google Cloud"], "cloud platforms"),
    "deploy cloud resource": (["Terraform", "AWS CloudFormation", "Pulumi", "AWS", "Microsoft Azure", "Google Cloud"],
                              "provisioning tools and cloud platforms"),
    "automate cloud tasks": (["Terraform", "AWS CloudFormation", "Pulumi", "Ansible"], "infrastructure-as-code automation"),
    "develop with cloud services": (["AWS Lambda", "Azure Functions", "AWS", "Microsoft Azure", "Google Cloud", "Firebase"],
                                    "cloud service development"),
    "cloud monitoring and reporting": (["Amazon CloudWatch", "Prometheus", "Grafana", "Datadog", "New Relic"], "cloud monitoring"),
    "design database in the cloud": (["Amazon RDS", "DynamoDB", "Cloud SQL", "Firestore"], "managed cloud databases"),
    "manage cloud data and storage": (["Amazon S3", "Amazon RDS", "DynamoDB"], "cloud storage services"),
    "design cloud networks": (["Amazon VPC"], "cloud virtual networking"),
    "cloud security and compliance": (["AWS IAM", "Identity and Access Management"], "cloud identity / access control"),
    "implement cloud security and compliance": (["AWS IAM", "Identity and Access Management", "HashiCorp Vault"],
                                                "cloud access control and secrets"),
    "manage keys for data protection": (["HashiCorp Vault"], "key / secret management"),
    "manage ICT virtualisation environments": (["VMware", "Hyper-V", "Proxmox"], "virtualisation platforms"),
    # systems, networks, support
    "ICT network routing": (["Routing and Switching", "BGP", "Cisco Networking", "CCNA"], "routing skills and certification"),
    "network engineering": (["Cisco Networking", "Routing and Switching", "CCNA"], "network engineering"),
    "ICT networking hardware": (["Cisco Networking", "Routing and Switching"], "network hardware"),
    "network management system tools": (["Network Administration"], "network administration tooling"),
    "implement ICT network diagnostic tools": (["Wireshark", "Network Troubleshooting"], "network diagnostics"),
    "analyse network configuration and performance": (["Wireshark", "Network Troubleshooting"], "network analysis"),
    "define firewall rules": (["Firewalls"], "firewall configuration"),
    "implement a firewall": (["Firewalls"], "firewall configuration"),
    "implement a virtual private network": (["VPN"], "the named skill itself"),
    "maintain internet protocol configuration": (["TCP/IP", "DHCP"], "IP configuration"),
    "domain name service": (["DNS"], "the named skill itself"),
    "implement anti-virus software": (["Endpoint Security"], "endpoint / anti-virus protection"),
    "protect ICT devices": (["Endpoint Security"], "endpoint protection"),
    "manage email hosting service": (["Microsoft Exchange", "Microsoft 365 Administration", "Google Workspace"], "email hosting"),
    "distributed directory information services": (["Active Directory", "LDAP"], "directory services"),
    "use back-up and recovery tools": (["Backup and Recovery"], "the named skill itself"),
    "perform backups": (["Backup and Recovery"], "the named skill itself"),
    "monitor system performance": (["Prometheus", "Grafana", "Datadog", "New Relic"], "system monitoring"),
    "administer ICT system": (["System Administration", "Windows Server", "Linux Server Administration", "Red Hat Enterprise Linux"],
                              "system administration"),
    "maintain ICT server": (["Windows Server", "Linux Server Administration", "System Administration"], "server administration"),
    "maintain ICT system": (["System Administration"], "system administration"),
    "perform ICT troubleshooting": (["Hardware Troubleshooting", "Network Troubleshooting"], "troubleshooting"),
    "repair ICT devices": (["Hardware Troubleshooting"], "hardware repair / troubleshooting"),
    "use ICT ticketing system": (["Jira", "ServiceNow"], "ticketing systems"),
    "provide ICT support": (["Help Desk"], "the named skill itself"),
    "support ICT system users": (["Help Desk"], "user support"),
    "use customer relationship management software": (["Salesforce", "HubSpot"], "CRM software"),
    "manage standard enterprise resource planning system": (["SAP", "SAP R/3"], "ERP software"),
    "ICT problem management techniques": (["ITIL"], "ITIL problem management"),
    "ICT process quality models": (["ITIL", "Six Sigma"], "process quality frameworks"),
    "mobile operating systems": (["Android Development", "iOS Development"], "mobile OS platforms"),
    "Internet of Things": (["IoT", "Arduino", "Raspberry Pi", "ESP32", "MQTT"], "IoT platforms"),
    "real-time computing": (["RTOS", "FreeRTOS"], "real-time operating systems"),
    "ICT communications protocols": (["TCP/IP", "MQTT"], "communication protocols"),
    "ICT performance analysis methods": (["Performance Testing", "JMeter", "LoadRunner"], "performance analysis"),
    # security
    "ICT network security risks": (["Network Security"], "network security knowledge"),
    "ethical hacking principles": (["Ethical Hacking", "Penetration Testing", "Certified Ethical Hacker", "Kali Linux", "Metasploit"],
                                   "ethical hacking practice"),
    "penetration testing tool": (["Metasploit", "Burp Suite", "Nmap", "Kali Linux", "OWASP ZAP", "Nessus", "John the Ripper"],
                                 "penetration testing tools"),
    "attack vectors": (["Penetration Testing", "Ethical Hacking", "MITRE ATT&CK"], "attack knowledge"),
    "cyber attack counter-measures": (["Intrusion Detection Systems", "Firewalls", "SIEM"], "defensive controls"),
    "web application security threats": (["OWASP", "Burp Suite", "OWASP ZAP"], "web application security"),
    "perform ICT security testing": (["Penetration Testing", "Security Testing", "Burp Suite", "Metasploit", "Nessus", "OWASP ZAP"],
                                     "security testing"),
    "identify ICT system weaknesses": (["Vulnerability Assessment", "Nessus", "Qualys", "Nmap"], "vulnerability assessment"),
    "identify ICT security risks": (["Vulnerability Assessment"], "security risk identification"),
    "collect cyber defence data": (["SIEM", "Splunk", "ELK Stack", "Wireshark"], "security data collection"),
    "handle cybersecurity incidents": (["Incident Response"], "the named skill itself"),
    "security threats": (["Threat Modeling", "MITRE ATT&CK"], "threat knowledge"),
    "use access control software": (["Identity and Access Management", "Active Directory", "LDAP"], "access control"),
    "maintain ICT identity management": (["Identity and Access Management", "Active Directory", "Single Sign-On", "SAML", "OAuth"],
                                         "identity management"),
    "manage digital identity": (["Identity and Access Management", "Single Sign-On", "SAML", "OAuth"], "digital identity"),
    "computer forensics": (["Digital Forensics"], "the named skill itself"),
    "use technology for forensics": (["Digital Forensics"], "forensic tooling"),
    "gather data for forensic purposes": (["Digital Forensics"], "forensic acquisition"),
    "perform forensic preservations of digital devices": (["Digital Forensics"], "forensic preservation"),
    "use software for data preservation": (["Digital Forensics"], "forensic imaging"),
    "ICT security standards": (["ISO 27001"], "security standard"),
    "establish an Information Security Management System": (["ISO 27001"], "ISO 27001 is the ISMS standard"),
    "manage IT security compliances": (["ISO 27001", "GDPR"], "compliance frameworks"),
    "data protection": (["GDPR"], "data protection regulation"),
    "ensure information privacy": (["GDPR"], "privacy regulation"),
    # testing
    "execute software tests": (["Selenium", "JUnit", "PyTest", "Cypress", "TestNG", "Postman", "Manual Testing"], "test execution"),
    "levels of software testing": (["Unit Testing", "Integration Testing", "Acceptance Testing", "ISTQB"], "test levels"),
    "perform software unit testing": (["Unit Testing", "JUnit", "PyTest", "Jest", "Mocha", "TestNG"], "unit testing"),
    "execute integration testing": (["Integration Testing", "Postman", "SoapUI", "REST Assured"], "integration testing"),
    "develop ICT test suite": (["Selenium", "JUnit", "PyTest", "TestNG", "Cypress", "Robot Framework"], "test suite development"),
    "tools for ICT test automation": (["Selenium", "Cypress", "Playwright", "Appium", "Robot Framework"], "test automation tools"),
    "plan software testing": (["ISTQB"], "test planning (ISTQB)"),
    "manage system testing": (["ISTQB"], "test management (ISTQB)"),
    "provide software testing documentation": (["TestRail"], "test documentation tool"),
    "measure software usability": (["Usability Testing"], "the named skill itself"),
    "application usability": (["Usability Testing"], "usability evaluation"),
    "assess users' interaction with ICT applications": (["Usability Testing", "User Research"], "user interaction research"),
    "execute ICT user research activities": (["User Research"], "the named skill itself"),
    # data
    "query languages": (["SQL", "SPARQL"], "database query languages"),
    "resource description framework query language": (["SPARQL"], "SPARQL is the RDF query language"),
    "test ICT queries": (["SQL"], "query testing"),
    "database management systems": (["MySQL", "PostgreSQL", "Oracle Database", "Microsoft SQL Server", "MongoDB", "MariaDB", "SQLite"],
                                    "DBMSs"),
    "use databases": (["MySQL", "PostgreSQL", "Oracle Database", "Microsoft SQL Server", "MongoDB", "MariaDB", "SQLite", "SQL"],
                      "databases"),
    "database": (["MySQL", "PostgreSQL", "Oracle Database", "Microsoft SQL Server", "MongoDB", "SQL"], "databases"),
    "manage database": (["Database Administration", "MySQL", "PostgreSQL", "Oracle Database", "Microsoft SQL Server"],
                        "database management"),
    "operate relational database management system": (["MySQL", "PostgreSQL", "Oracle Database", "Microsoft SQL Server", "MariaDB"],
                                                      "relational DBMSs"),
    "database development tools": (["MySQL Workbench", "pgAdmin", "Oracle SQL Developer", "Data Modeling"], "database design tools"),
    "design database scheme": (["Data Modeling", "Database Normalization", "MySQL Workbench"], "schema design"),
    "create database diagrams": (["Data Modeling", "MySQL Workbench"], "database diagrams"),
    "create data models": (["Data Modeling", "UML"], "data modelling"),
    "data models": (["Data Modeling"], "data modelling"),
    "normalise data": (["Database Normalization"], "ESCO: database normalisation"),
    "maintain database performance": (["Database Administration"], "DBA work"),
    "balance database resources": (["Database Administration"], "DBA work"),
    "data warehouse": (["Data Warehousing", "Snowflake", "Amazon Redshift", "BigQuery", "Teradata"], "data warehouses"),
    "implement data warehousing techniques": (["Data Warehousing", "Snowflake", "Amazon Redshift", "BigQuery", "ETL"],
                                              "data warehousing"),
    "data extraction, transformation and loading tools": (["ETL", "Informatica PowerCenter", "SQL Server Integration Services",
                                                          "Apache NiFi", "AWS Glue", "Pentaho Data Integration", "dbt"], "ETL tools"),
    "integrate ICT data": (["ETL", "Apache NiFi", "Informatica PowerCenter", "AWS Glue"], "data integration"),
    "inter-organisational middleware system": (["Kafka", "RabbitMQ", "IBM MQ"], "message-oriented middleware"),
    "data visualisation software": (["Tableau", "Power BI", "Qlik Sense", "Looker", "D3.js", "Matplotlib", "Plotly"],
                                    "data visualisation tools"),
    "deliver visual presentation of data": (["Tableau", "Power BI", "Matplotlib", "Seaborn", "Plotly", "D3.js"], "data visualisation"),
    "visual presentation techniques": (["Tableau", "Power BI", "Matplotlib", "D3.js"], "data visualisation"),
    "perform data mining": (["Data Mining"], "the named skill itself"),
    "analyse big data": (["Big Data", "Apache Spark", "Hadoop", "Apache Hive", "Databricks"], "big data tools"),
    "use data processing techniques": (["Pandas", "NumPy", "Apache Spark"], "data processing libraries"),
    "process data": (["Pandas", "Apache Spark"], "data processing"),
    "develop data processing applications": (["Apache Spark", "Apache Flink", "Kafka", "Pandas"], "data processing frameworks"),
    "perform data cleansing": (["Data Cleaning", "Pandas"], "data cleansing"),
    "online analytical processing": (["Data Warehousing"], "OLAP sits on data warehouses"),
    "apply statistical analysis techniques": (["Statistics", "R", "SPSS", "SAS", "Stata", "Statistical Modeling"], "statistical analysis"),
    "statistical modeling techniques": (["Statistical Modeling", "R", "SAS", "Stata"], "statistical modelling"),
    "quantitative analysis": (["Statistics", "R", "SPSS", "Stata"], "quantitative analysis"),
    "carry out statistical forecasts": (["Statistical Modeling", "R", "SAS"], "statistical forecasting"),
    "statistical analysis system software": (["SAS"], "SAS is the named software"),
    "develop statistical software": (["R"], "statistical programming language"),
    "execute analytical mathematical calculations": (["MATLAB", "NumPy", "R", "Julia"], "numerical computing"),
    "mathematical modelling": (["MATLAB", "Statistical Modeling"], "mathematical modelling"),
    "scientific computing": (["NumPy", "MATLAB", "Julia"], "scientific computing"),
    "utilise machine learning": (["Machine Learning", "Scikit-learn", "TensorFlow", "PyTorch", "Keras", "XGBoost"], "ML"),
    "principles of artificial intelligence": (["Artificial Intelligence", "Machine Learning", "Deep Learning"], "AI knowledge"),
    "artificial neural networks": (["Neural Networks", "Deep Learning", "TensorFlow", "PyTorch", "Keras",
                                    "Convolutional Neural Networks", "Recurrent Neural Networks"], "neural networks"),
    "image recognition": (["Computer Vision", "OpenCV", "Convolutional Neural Networks", "YOLO"], "image recognition"),
    "develop computer vision system": (["Computer Vision", "OpenCV", "YOLO", "PyTorch", "TensorFlow"], "computer vision"),
    "digital image processing": (["OpenCV", "Computer Vision"], "image processing"),
    "perform dimensionality reduction": (["Scikit-learn"], "PCA etc. in scikit-learn"),
    "build recommender systems": (["Recommender Systems"], "the named skill itself"),
    "information extraction": (["Natural Language Processing", "spaCy", "NLTK"], "NLP information extraction"),
    # business / project
    "ICT project management methodologies": (["Agile", "Scrum", "Kanban", "Waterfall", "Lean"], "PM methodologies"),
    "ICT project management": (["Project Management", "PMP"], "IT project management"),
    "perform project management": (["Project Management", "PMP", "Microsoft Project"], "project management"),
    "manage ICT project": (["Project Management", "PMP", "Microsoft Project"], "project management"),
    "business process modelling": (["UML"], "UML activity diagrams model processes"),
    "create business process models": (["UML"], "UML activity diagrams model processes"),
    "perform business analysis": (["Business Analysis"], "the named skill itself"),
    "business requirements techniques": (["Requirements Gathering", "Business Analysis"], "requirements techniques"),
    "interact with users to gather requirements": (["Requirements Gathering"], "the named skill itself"),
    "analyse business requirements": (["Business Analysis", "Requirements Gathering"], "requirements analysis"),
    "web based collaborative platforms": (["Confluence", "SharePoint", "Notion", "Google Workspace"], "collaboration platforms"),
    # web content and marketing
    "use content management system software": (["WordPress", "Drupal", "Joomla", "Contentful", "Strapi"], "CMSs"),
    "apply tools for content development": (["WordPress", "Drupal", "Joomla"], "content tools"),
    "manage online content": (["WordPress", "Drupal", "Joomla"], "CMSs"),
    "conduct search engine optimisation": (["SEO", "Keyword Research"], "SEO"),
    "enhance website visibility": (["SEO"], "SEO"),
    "keywords in digital content": (["Keyword Research", "SEO"], "keyword research"),
    "web analytics": (["Google Analytics", "Marketing Analytics"], "web analytics"),
    "study website behaviour patterns": (["Google Analytics"], "web analytics"),
    "perform online data analysis": (["Google Analytics"], "web analytics"),
    "apply social media marketing": (["Social Media Marketing"], "the named skill itself"),
    "social media marketing techniques": (["Social Media Marketing"], "the named skill itself"),
    "content marketing strategy": (["Content Marketing"], "the named skill itself"),
    "troubleshoot website": (["Browser DevTools"], "web debugging"),
    # design, 3D, video
    "operate 3D computer graphics software": (["Blender", "Maya"], "3D packages"),
    "render 3D images": (["Blender", "Maya"], "3D rendering"),
    "3D texturing": (["Blender", "Maya"], "texturing in 3D packages"),
    "create 3D texture map": (["Blender", "Maya"], "texturing in 3D packages"),
    "3D lighting": (["Blender", "Maya"], "lighting in 3D packages"),
    "create 3D environments": (["Blender", "Maya", "Unreal Engine", "Unity"], "3D environment building"),
    "create 3D characters": (["Blender", "Maya"], "character modelling"),
    "animate 3D organic forms": (["Blender", "Maya"], "3D animation"),
    "rig 3D characters": (["Blender", "Maya"], "rigging"),
    "use polygonal modelling": (["Blender", "Maya"], "polygonal modelling"),
    "apply 3D imaging techniques": (["Blender", "Maya"], "3D imaging"),
    "particle animation": (["Blender", "Maya"], "particle systems"),
    "develop animations": (["Adobe After Effects", "Blender", "Maya"], "animation tools"),
    "create moving images": (["Adobe After Effects", "Blender", "Maya"], "animation tools"),
    "convert into animated object": (["Adobe After Effects", "Blender"], "animation tools"),
    "edit digital moving images": (["Adobe Premiere Pro", "Final Cut Pro", "DaVinci Resolve", "Adobe After Effects"], "video editing"),
    "digital compositing": (["Adobe After Effects"], "compositing"),
    "design graphics": (["Adobe Photoshop", "Adobe Illustrator", "GIMP", "CorelDRAW"], "graphics tools"),
    "create digital images": (["Adobe Photoshop", "Adobe Illustrator", "GIMP"], "digital imaging"),
    "perform image editing": (["Adobe Photoshop", "GIMP", "Adobe Lightroom"], "image editing"),
    "graphics editor software": (["Adobe Photoshop", "Adobe Illustrator", "GIMP", "CorelDRAW"], "graphics editors"),
    "adobe creative suite": (["Adobe Creative Cloud", "Adobe Photoshop", "Adobe Illustrator", "Adobe InDesign",
                              "Adobe Premiere Pro", "Adobe After Effects", "Adobe XD"], "Adobe apps"),
    "use creative suite software": (["Adobe Creative Cloud", "Adobe Photoshop", "Adobe Illustrator", "Adobe InDesign"], "Adobe apps"),
    "desktop publishing": (["Adobe InDesign"], "DTP software"),
    "apply desktop publishing techniques": (["Adobe InDesign"], "DTP software"),
    "create website wireframe": (["Figma", "Sketch", "Adobe XD", "Balsamiq"], "wireframing tools"),
    "design user interface": (["Figma", "Sketch", "Adobe XD", "UI/UX Design"], "UI design tools"),
    "software interaction design": (["Figma", "Adobe XD", "UX Design"], "interaction design"),
    "create prototype of user experience solutions": (["Figma", "Adobe XD", "Sketch", "InVision", "Prototyping"], "UX prototyping"),
    "use methodologies for user-centered design": (["UX Design", "Design Thinking", "User Research"], "UCD practice"),
    "digital game creation systems": (["Unity", "Unreal Engine", "Godot", "GameMaker", "CryEngine"], "game engines"),
    "use CAD software": (["AutoCAD", "SolidWorks"], "CAD software"),
    "CAD software": (["AutoCAD", "SolidWorks"], "CAD software"),
    "use technical drawing software": (["AutoCAD", "SolidWorks"], "technical drawing software"),
    "technical drawings": (["AutoCAD", "SolidWorks"], "technical drawing software"),
    "computer simulation": (["MATLAB"], "simulation environment"),
    "conduct quantitative research": (["SPSS", "R", "Stata", "Statistics"], "quantitative analysis tools"),
}

# ── role-specific overrides: role → {phrase: (skills, reason)} ────────────────
GENERAL_LANGS = (["Java", "Python", "C#", "C++", "JavaScript", "TypeScript", "Go", "Kotlin"], "general-purpose programming languages")
MOBILE_LANGS = (["Kotlin", "Swift", "Java", "Dart", "Objective-C", "Flutter", "SwiftUI"], "mobile languages / SDKs")
MOBILE_IDE = (["Android Studio", "Xcode", "IntelliJ IDEA", "Visual Studio Code"], "mobile IDEs")
WEB_IDE = (["Visual Studio Code", "IntelliJ IDEA", "Visual Studio"], "web IDEs")
WEB_DEBUG = (["Debugging", "Browser DevTools"], "debugging practice and browser tools")
EMBEDDED_LANGS = (["C", "C++", "Rust", "Assembly Language"], "embedded languages")
CLOUD_IDE = (["Visual Studio Code", "IntelliJ IDEA", "Visual Studio", "PyCharm", "Eclipse"], "IDEs")
GAME_RENDER = (["Unity", "Unreal Engine", "OpenGL", "DirectX", "Vulkan", "Blender"], "game engines and graphics APIs")
NETWORK_LANGS = (["Python", "Bash", "PowerShell", "Perl"], "scripting/programming used in network work")
UX_NO_INTERVIEW = ([], "")

ROLE = {
    "ICT application configurator": {"computer programming": GENERAL_LANGS},
    "ICT application developer": {"computer programming": GENERAL_LANGS},
    "ICT system developer": {"computer programming": GENERAL_LANGS},
    "software developer": {"computer programming": GENERAL_LANGS},
    "mobile application developer": {"computer programming": MOBILE_LANGS, "integrated development environment software": MOBILE_IDE,
                                     "use software libraries": (["Android Jetpack", "Retrofit", "Firebase"], "mobile libraries")},
    "industrial mobile devices software developer": {"computer programming": MOBILE_LANGS,
                                                     "integrated development environment software": MOBILE_IDE},
    "web developer": {"computer programming": (["JavaScript", "TypeScript", "PHP", "Python", "Ruby", "Java", "C#"], "web languages"),
                      "integrated development environment software": WEB_IDE, "ICT debugging tools": WEB_DEBUG,
                      "debug software": WEB_DEBUG, "use software libraries": (["React", "jQuery"], "front-end libraries")},
    "user interface developer": {"computer programming": (["JavaScript", "TypeScript"], "front-end languages"),
                                 "integrated development environment software": WEB_IDE,
                                 "use software libraries": (["React", "jQuery"], "front-end libraries")},
    "embedded systems software developer": {"computer programming": EMBEDDED_LANGS,
                                            "integrated development environment software": (["Eclipse", "Visual Studio Code", "Visual Studio"], "IDEs")},
    "embedded systems security engineer": {"computer programming": (EMBEDDED_LANGS[0] + ["Python"], "embedded and security languages")},
    "digital games developer": {"computer programming": (["C++", "C#", "Lua"], "game programming languages"),
                                "integrated development environment software": (["Visual Studio", "Visual Studio Code"], "IDEs"),
                                "render 3D images": GAME_RENDER, "3D lighting": (["Unity", "Unreal Engine", "Blender"], "engine lighting"),
                                "apply 3D imaging techniques": (["Blender", "Maya", "Unity", "Unreal Engine"], "3D tools and engines")},
    "blockchain developer": {"computer programming": (["Solidity", "Rust", "Go", "JavaScript", "TypeScript"], "blockchain languages")},
    "artificial intelligence engineer": {"computer programming": (["Python", "C++", "R", "Julia", "Java"], "AI languages")},
    "computer vision engineer": {"computer programming": (["Python", "C++"], "CV languages"),
                                 "integrated development environment software": (["PyCharm", "Visual Studio Code", "Jupyter Notebook"], "IDEs"),
                                 "use software libraries": (["OpenCV", "NumPy", "Scikit-learn", "PyTorch", "TensorFlow"], "CV/ML libraries")},
    "cloud engineer": {"computer programming": (["Python", "Go", "Java", "TypeScript", "JavaScript"], "cloud development languages")},
    "cloud DevOps engineer": {"integrated development environment software": CLOUD_IDE},
    "cloud software developer": {"integrated development environment software": CLOUD_IDE},
    "ICT network administrator": {"computer programming": NETWORK_LANGS},
    "ICT network engineer": {"computer programming": NETWORK_LANGS},
    "ethical hacker": {"computer programming": (["Python", "C", "C++", "Assembly Language", "Bash", "PowerShell"], "security languages")},
    "webmaster": {"maintain ICT server": (["Apache HTTP Server", "Nginx", "Linux Server Administration"], "web servers")},
    # the phrase means something other than the tools in these roles
    "blockchain architect": {"digital identity management": ([], "")},
    "blockchain developer_": {},
    "graphic designer": {"design prototypes": (["Figma", "Adobe XD"], "design mock-ups")},
    "user interface designer": {"translate requirements into visual design": (["Figma", "Sketch", "Adobe XD"], "UI design tools")},
    "user experience analyst": {"conduct quantitative research": ([], ""), "conduct research interview": (["User Research"], "UX research")},
    "ICT usability tester": {"conduct research interview": (["User Research"], "UX research")},
    "ICT accessibility tester": {"conduct research interview": (["User Research"], "UX research"),
                                 "screen reader": (["Accessibility Testing"], "screen-reader testing")},
    "ICT research consultant": {"execute ICT user research activities": (["User Research"], "user research")},
    "data centre operator": {"maintain ICT server": (["Windows Server", "Linux Server Administration", "VMware"], "data-centre servers")},
    "numerical tool and process control programmer": {},
}
ROLE.pop("blockchain developer_")


def vocabulary():
    """canonical key → curated name (the existing skill vocabulary)."""
    curated = json.loads(Path(common.descriptions_module.CURATED_FILE).read_text(encoding="utf8"))
    return {normalise_skill(name)[0]: name for name in curated if not name.startswith("_")}


def role_phrases():
    provider = get_description_provider()
    out = {}
    for prof in sorted(common.db()["professions"].find({"active": True, "source": "esco"}, {"title": 1, "skills": 1}),
                       key=lambda p: p["title"]):
        names = []
        for skill in prof["skills"]:
            if skill.get("type") == "essential":
                _, name = current_skill(skill)
                if provider.lookup(name) is None and name not in names:
                    names.append(name)
        out[prof["title"]] = names
    return out


def main():
    vocab = vocabulary()
    pairs = role_phrases()
    unknown_roles = set(ROLE) - set(pairs)
    if unknown_roles:
        raise SystemExit(f"unknown roles in ROLE: {sorted(unknown_roles)}")
    unknown = set()

    def resolve(names):
        out = []
        for name in names:
            key = normalise_skill(name)[0]
            if key not in vocab:
                unknown.add(name)
            elif vocab[key] not in out:
                out.append(vocab[key])
        return out

    entries, phrase_not_found = [], set()
    for role, phrases in pairs.items():
        for phrase in phrases:
            source = "role" if phrase in ROLE.get(role, {}) else ("default" if phrase in DEFAULT else None)
            skills, reason = (ROLE[role][phrase] if source == "role" else DEFAULT.get(phrase, ([], "")))
            skills = resolve(skills)[:8]
            entries.append({"role": role, "phrase": phrase, "skills": skills, "reason": reason if skills else "",
                            "source": source if skills else None})
    for table_phrase in DEFAULT:
        if not any(table_phrase in p for p in pairs.values()):
            phrase_not_found.add(table_phrase)
    for role, overrides in ROLE.items():
        for phrase in overrides:
            if phrase not in pairs[role]:
                phrase_not_found.add(f"{role} / {phrase}")
    if unknown or phrase_not_found:
        raise SystemExit(f"unknown skill names: {sorted(unknown)}\nphrases not in the roles: {sorted(phrase_not_found)}")

    mapped = [e for e in entries if e["skills"]]
    stats = {"pairs": len(entries), "mapped_pairs": len(mapped), "mapped_share": round(len(mapped) / len(entries), 3),
             "avg_skills_per_mapped_pair": round(sum(len(e["skills"]) for e in mapped) / len(mapped), 2),
             "distinct_phrases": len({e["phrase"] for e in entries}),
             "distinct_phrases_mapped": len({e["phrase"] for e in mapped}),
             "role_specific_entries": sum(e["source"] == "role" for e in mapped),
             "distinct_skills_used": len({s for e in mapped for s in e["skills"]}),
             "roles_with_a_mapping": len({e["role"] for e in mapped}), "roles": len(pairs)}
    doc = {"_comment": "Module 5.1 sandbox (not used by production): role-aware ESCO essential phrase → skill mapping, AI-assisted "
                       "and conservative; built by build_role_phrase_map.py. See ROLE_PHRASE_MAP_README.md.",
           "built": date.today().isoformat(), "stats": stats, "entries": entries}
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(stats, indent=1))
    print("most used skills:", Counter(s for e in mapped for s in e["skills"]).most_common(15))


if __name__ == "__main__":
    main()
