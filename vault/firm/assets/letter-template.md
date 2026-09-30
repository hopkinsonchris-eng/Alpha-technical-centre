---
kind: template
applies_to: letter
languages: [en, es]
version: 1
---
{{letterhead}}

Our ref: {{reference_no}}{{#their_reference}}    Your ref: {{their_reference}}{{/their_reference}}
{{date_words}}

{{contact.name}}
{{contact.role}}
{{organisation.name}}
{{contact.postal_address}}

{{#subject}}**{{subject}}**{{/subject}}

{{salutation}}

{{body}}

{{closing}}

{{signatory.signature_block}}

{{#previous_correspondence}}
Previous correspondence: {{.}}
{{/previous_correspondence}}
