import json

def pad0(): return {"padding-block-start":0,"padding-block-end":0,"padding-inline-start":0,"padding-inline-end":0}

def ftext(html, preset="rte"):
    s={"text":html,"width":"100%","max_width":"normal","alignment":"left","type_preset":preset,"font":"var(--font-body--family)",
       "font_size":"1rem","line_height":"normal","letter_spacing":"normal","case":"none","wrap":"pretty","background":False,
       "background_color":"#00000026","corner_radius":0}
    s.update(pad0()); return {"type":"text","settings":s,"blocks":{}}

def fgroup(blocks, order, gap=6):
    s={"content_direction":"column","vertical_on_mobile":True,"horizontal_alignment":"flex-start","vertical_alignment":"flex-start",
       "align_baseline":False,"horizontal_alignment_flex_direction_column":"flex-start","vertical_alignment_flex_direction_column":"flex-start",
       "gap":gap,"width":"fill","custom_width":100,"width_mobile":"fill","custom_width_mobile":100,"height":"fit","custom_height":100,
       "background_media":"none","video_position":"cover","background_image_position":"cover","border":"none","border_width":1,
       "border_opacity":100,"border_radius":0,"toggle_overlay":False,"overlay_color":"#00000026","overlay_style":"solid",
       "gradient_direction":"to top","open_in_new_tab":False}
    s.update(pad0()); return {"type":"group","settings":s,"blocks":blocks,"block_order":order}

WA="https://wa.me/5516994047755"
S={}

# Newsletter (estrutura original, textos em português)
S["footer_m9NzUG"]={"type":"footer","blocks":{
    "group_H6VpwJ":fgroup({"text_LWt8Pz":ftext("<h2>Receba novidades da Dabela</h2>","h4"),
                           "text_f9CFLH":ftext("<p>Lançamentos, condições especiais e inspirações com propósito, direto no seu e-mail.</p>")},
                          ["text_LWt8Pz","text_f9CFLH"]),
    "email_signup_crihX7":{"type":"email-signup","settings":dict({"width":"fill","custom_width":100,"heading_preset":"h3",
        "border_style":"all","input_style":"custom","border_width":1,"border_radius":100,
        "input_background_color":"{{ settings.color_palette.background }}","input_text_color":"{{ settings.color_palette.color1 }}",
        "input_border_color":"{{ settings.color_palette.color2 }}","input_type_preset":"paragraph","style_class":"button-unstyled",
        "display_type":"arrow","label":"Cadastrar","integrated_button":True,"button_type_preset":"paragraph"},**pad0()),"blocks":{}}},
  "block_order":["group_H6VpwJ","email_signup_crihX7"],"name":"t:names.footer",
  "settings":{"section_width":"page-width","gap":20,"background_color":"{{ settings.color_palette.background }}",
              "padding-block-start":30,"padding-block-end":30}}

# Informações da loja: marca, coleção e atendimento
S["footer_info"]={"type":"footer","blocks":{
    "group_fBrand":fgroup({
        "text_fBrandH":ftext("<p><strong>Dabela Joias com Propósito</strong></p>","h6"),
        "text_fBrandP":ftext("<p>Na Dabela, cada joia é criada para ser mais que um acessório: um símbolo de propósito, força e identidade. Celebramos o brilho único de cada mulher.</p>")},
        ["text_fBrandH","text_fBrandP"],gap=8),
    "group_fCol":fgroup({
        "text_fColH":ftext("<p><strong>Coleção</strong></p>","h6"),
        "text_fColL":ftext('<p><a href="/collections/colares">Colares</a><br/><a href="/collections/brincos">Brincos</a><br/><a href="/collections/pulseiras">Pulseiras e Braceletes</a><br/><a href="/collections/infantil">Infantil</a><br/><a href="/collections/all">Todas as joias</a></p>')},
        ["text_fColH","text_fColL"],gap=8),
    "group_fAtend":fgroup({
        "text_fAtH":ftext("<p><strong>Atendimento</strong></p>","h6"),
        "text_fAtP":ftext(f'<p><a href="{WA}">WhatsApp (16) 99404-7755</a><br/><a href="mailto:contato@dabelasemijoias.com.br">contato@dabelasemijoias.com.br</a><br/>Seg a sex · 9h às 12h e 14h às 18h</p>')},
        ["text_fAtH","text_fAtP"],gap=8),
    "group_fLegal":fgroup({
        "text_fLegH":ftext("<p><strong>Dabela</strong></p>","h6"),
        "text_fLegP":ftext("<p>CNPJ 18.616.290/0001-68<br/>R. Antônio Deloiágono, 500, Sala 31<br/>Vila Ana Maria · Ribeirão Preto, SP</p>")},
        ["text_fLegH","text_fLegP"],gap=8)},
  "block_order":["group_fBrand","group_fCol","group_fAtend","group_fLegal"],"name":"t:names.footer",
  "settings":{"section_width":"page-width","gap":32,"background_color":"{{ settings.color_palette.color2 }}",
              "padding-block-start":40,"padding-block-end":40}}

# Utilidades: copyright, políticas e Instagram
S["footer_utilities_jLGE8U"]={"type":"footer-utilities","blocks":{
    "footer_copyright_jweRK8":{"type":"footer-copyright","settings":{"show_powered_by":False,"font_size":"0.75rem","case":"none"},"blocks":{}},
    "footer_policy_list_VCdnpa":{"type":"footer-policy-list","settings":{"font_size":"0.75rem","case":"none"},"blocks":{}},
    "social_links_Ew63Kq":{"type":"social-links","settings":{"facebook_url":"","instagram_url":"https://www.instagram.com/dabelasemijoias/",
        "youtube_url":"","tiktok_url":"","twitter_url":""},"blocks":{}}},
  "block_order":["footer_copyright_jweRK8","footer_policy_list_VCdnpa","social_links_Ew63Kq"],"name":"t:names.utilities",
  "settings":{"section_width":"page-width","gap":24,"divider_thickness":1,"divider_color":"{{ settings.color_palette.color2 }}",
              "background_color":"{{ settings.color_palette.color2 }}","padding-block-start":20,"padding-block-end":48}}

data={"type":"footer","name":"t:names.footer","sections":S,"order":["footer_m9NzUG","footer_info","footer_utilities_jLGE8U"]}
header=open("index.json").read().split("{",1)[0]
out=json.dumps(data,ensure_ascii=False,indent=2); json.loads(out)
open("footer-group.json","w",encoding="utf-8").write(header+out+"\n")
print("ok",len(out))
