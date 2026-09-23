import json, copy

def pad0(): return {"padding-block-start":0,"padding-block-end":0,"padding-inline-start":0,"padding-inline-end":0}

def group(blocks, order, direction="column", gap=12, h_col="flex-start", width="fill", custom_width=100, h_align="flex-start"):
    s={"content_direction":direction,"vertical_on_mobile":True,"horizontal_alignment":h_align,"vertical_alignment":"center",
       "align_baseline":False,"horizontal_alignment_flex_direction_column":h_col,"vertical_alignment_flex_direction_column":"center",
       "gap":gap,"width":width,"custom_width":custom_width,"width_mobile":"fill","custom_width_mobile":100,"height":"fit","custom_height":100,
       "background_media":"none","background_color":"","video_position":"cover","background_image_position":"cover","toggle_overlay":False,
       "overlay_color":"#00000026","overlay_style":"solid","gradient_direction":"to top","border":"none","border_width":1,"border_opacity":100,
       "border_color":"","border_radius":0,"link":"","open_in_new_tab":False,"placeholder":""}
    s.update(pad0())
    return {"type":"group","settings":s,"blocks":blocks,"block_order":order}

def text(html, preset="rte", align="left", max_width="normal", width="fit-content", name=None, case="none", letter="normal", color=""):
    s={"text":html,"width":width,"max_width":max_width,"alignment":align,"type_preset":preset,"font":"var(--font-body--family)",
       "font_size":"1rem","line_height":"normal","letter_spacing":letter,"case":case,"wrap":"pretty","text_color":color,
       "background":False,"background_color":"#00000026","corner_radius":0}
    s.update(pad0())
    b={"type":"text","settings":s,"blocks":{}}
    if name: b["name"]=name
    return b

def button(label, link, style="button", new_tab=False):
    return {"type":"button","settings":{"label":label,"link":link,"open_in_new_tab":new_tab,"style_class":style,
        "custom_button_background":"{{ settings.color_palette.foreground }}","custom_button_text":"{{ settings.color_palette.background }}",
        "custom_button_border":"{{ settings.color_palette.background }}","link_text_color":"","width":"fit-content","custom_width":100,
        "width_mobile":"fit-content","custom_width_mobile":100},"blocks":{}}

def image(src):
    s={"image":src,"link":"shopify://collections/all","image_ratio":"portrait","width":"fill","custom_width":100,"width_mobile":"fill",
       "custom_width_mobile":100,"height":"fit","border":"solid","border_width":1,"border_opacity":100,
       "border_color":"{{ settings.color_palette.color4 }}","border_radius":20}
    s.update(pad0())
    return {"type":"image","settings":s,"blocks":{}}

def icon(name):
    return {"type":"icon","settings":{"icon":name,"width":32,"link":"","open_in_new_tab":False,"icon_color":""},"blocks":{}}

def section(blocks, order, name, direction="row", bg="", pt=40, pb=40, gap=32, h_col="flex-start"):
    return {"type":"section","blocks":blocks,"block_order":order,"name":name,"settings":{
        "content_direction":direction,"vertical_on_mobile":True,"horizontal_alignment":"flex-start","vertical_alignment":"center",
        "align_baseline":False,"horizontal_alignment_flex_direction_column":h_col,"vertical_alignment_flex_direction_column":"center",
        "gap":gap,"section_width":"page-width","section_height":"","section_height_custom":50,"background_media":"none",
        "background_color":bg,"video_position":"cover","background_image_position":"cover","toggle_overlay":False,
        "overlay_color":"#00000026","overlay_style":"solid","gradient_direction":"to top","border":"none","border_width":1,
        "border_opacity":100,"border_color":"","border_radius":0,"padding-block-start":pt,"padding-block-end":pb}}

GREEN="{{ settings.color_palette.color1 }}"
CREAM2="{{ settings.color_palette.color2 }}"
WA="https://wa.me/5516994047755?text=Ol%C3%A1%2C%20Dabela%21%20Vim%20pelo%20site%20e%20gostaria%20de%20conhecer%20as%20joias%20com%20prop%C3%B3sito."
S={}

# 1. Banner
S["section_eKPPTg"]=section(
  {"group_exUXnF":group({
      "text_TQAwiz":text("<p>Joias com Propósito.</p>","h1",name="t:names.heading"),
      "text_HQYtK9":text("<p>Uma joia que expressa fé, presença e propósito. Semijoias banhadas a ouro 18k, criadas para celebrar o brilho único de cada mulher. Peças com significado para os momentos que importam.</p>",max_width="narrow"),
      "button_kNrRrR":button("Descobrir a coleção","shopify://collections/all"),
      "button_94GhmW":button("Falar no WhatsApp",WA,"button-secondary",True)},
      ["text_TQAwiz","text_HQYtK9","button_kNrRrR","button_94GhmW"],gap=20,width="custom"),
   "image_bgKPkz":image("shopify://shop_images/viverei-2.webp")},
  ["group_exUXnF","image_bgKPkz"],"t:names.image_with_text")

# 2. Faixa de confiança
trust=[("gxmwWM","price_tag","Pague parcelado","até 12x no cartão"),("h4HPgj","truck","Entrega garantida","para todo o Brasil"),
       ("nJJkHz","return","Primeira troca grátis","você tem 30 dias"),("Q9tBjW","lock","Compra 100% segura","seus dados protegidos")]
def item(i,ic,t,sub,prefix):
    return group({f"icon_{prefix}{i}":icon(ic),
                  f"group_{prefix}t{i}":group({f"text_{prefix}a{i}":text(f"<p><strong>{t}</strong></p>","h6","center",width="100%"),
                                               f"text_{prefix}b{i}":text(f"<p>{sub}</p>","rte","center",width="100%")},
                                              [f"text_{prefix}a{i}",f"text_{prefix}b{i}"],gap=4)},
                 [f"icon_{prefix}{i}",f"group_{prefix}t{i}"],gap=12,h_col="center")
tb={};to=[]
for i,(k,ic,t,sub) in enumerate(trust):
    tb[f"group_{k}"]=item(i,ic,t,sub,"tr"); to.append(f"group_{k}")
S["section_JTKzfe"]=section(tb,to,"t:names.icons_with_text",bg=CREAM2,pt=28,pb=28,gap=16)

# 3. Os 7 mais vendidos (estrutura original do tema, só textos ajustados)
def plist_text(html, preset):
    s={"text":html,"width":"fit-content","max_width":"normal","alignment":"left","type_preset":preset,"font":"var(--font-body--family)",
       "font_size":"1rem","line_height":"normal","letter_spacing":"normal","case":"none","wrap":"pretty","text_color":"",
       "background":False,"background_color":"#00000026","corner_radius":0}; s.update(pad0()); return s
S["product_list_fa6P9H"]={"type":"product-list","blocks":{
  "static-header":{"type":"_product-list-content","name":"t:names.header","static":True,"settings":dict({
      "content_direction":"row","vertical_on_mobile":False,"horizontal_alignment":"space-between","vertical_alignment":"flex-end",
      "align_baseline":True,"horizontal_alignment_flex_direction_column":"flex-start","vertical_alignment_flex_direction_column":"center",
      "gap":12,"width":"fill","custom_width":100,"width_mobile":"fill","custom_width_mobile":100,"height":"fit","custom_height":100,
      "background_media":"none","background_color":"","video_position":"cover","background_image_position":"cover","border":"none",
      "border_width":1,"border_opacity":100,"border_color":"","border_radius":0},**pad0()),
    "blocks":{
      "product_list_text_YFtzcL":{"type":"_product-list-text","name":"t:names.collection_title",
        "settings":plist_text("<p>Sete peças, sete promessas</p>","h2"),"blocks":{}},
      "product_list_button_MWeP9V":{"type":"_product-list-button","name":"t:names.product_list_button","settings":{
        "label":"Ver todas","open_in_new_tab":False,"style_class":"link","custom_button_background":"{{ settings.color_palette.foreground }}",
        "custom_button_text":"{{ settings.color_palette.background }}","custom_button_border":"{{ settings.color_palette.background }}",
        "link_text_color":"","width":"fit-content","custom_width":100,"width_mobile":"fit-content","custom_width_mobile":100},"blocks":{}}},
    "block_order":["product_list_text_YFtzcL","product_list_button_MWeP9V"]},
  "static-product-card":{"type":"_product-card","name":"t:names.product_card","static":True,"settings":dict({
      "product_card_gap":4,"background_color":"","border":"none","border_width":1,"border_opacity":100,"border_color":"","border_radius":0},**pad0()),
    "blocks":{
      "product_card_gallery_677WP3":{"type":"_product-card-gallery","name":"t:names.product_card_media","settings":dict({
          "image_ratio":"adapt","border":"none","border_width":1,"border_opacity":100,"border_color":"","border_radius":0},**pad0()),"blocks":{}},
      "product_title_YXxMTj":{"type":"product-title","name":"t:names.product_title","settings":{
          "width":"100%","max_width":"normal","alignment":"left","type_preset":"rte","font":"var(--font-body--family)","font_size":"1rem",
          "line_height":"normal","letter_spacing":"normal","case":"none","wrap":"pretty","text_color":"","background":False,
          "background_color":"#00000026","corner_radius":0,"padding-block-start":4,"padding-block-end":0,"padding-inline-start":0,
          "padding-inline-end":0},"blocks":{}},
      "price_JQzVV4":{"type":"price","name":"t:names.product_price","settings":dict({
          "show_sale_price_first":True,"show_installments":False,"show_tax_info":False,"type_preset":"h6","width":"100%","alignment":"left",
          "font":"var(--font-body--family)","font_size":"1rem","line_height":"normal","letter_spacing":"normal","case":"none","text_color":""},**pad0()),"blocks":{}}},
    "block_order":["product_card_gallery_677WP3","product_title_YXxMTj","price_JQzVV4"]}},
  "name":"t:names.product_list","settings":{"collection":"all","layout_type":"grid","carousel_on_mobile":False,"max_products":8,
    "columns":4,"mobile_columns":"2","mobile_card_size":"60cqw","columns_gap":8,"rows_gap":24,"icons_style":"arrow","icons_shape":"none",
    "section_width":"page-width","horizontal_alignment":"flex-start","gap":28,"background_color":"{{ settings.color_palette.background }}",
    "padding-block-start":48,"padding-block-end":48}}

# 4. Propósito: cabeçalho
S["section_propHead"]=section(
  {"group_propHead":group({
      "text_propEye":text("<p>O PROPÓSITO DE CADA PEÇA</p>","rte","center"),
      "text_propH":text("<p>Mais que um acessório</p>","h2","center",name="t:names.heading")},
    ["text_propEye","text_propH"],gap=8,h_col="center",h_align="center")},
  ["group_propHead"],"t:names.image_with_text",direction="column",bg=GREEN,pt=56,pb=0,h_col="center")

# 5-7. Propósito: 3 peças, foto alternando de lado
rows=[("Mil","MILAGRES · COLAR VIVEREI MILAGRES","Para quem crê antes de ver.",
       "Um pingente circular com a frase \"Viverei Milagres\" e uma borboleta que representa renovo e liberdade. Um lembrete diário de que a vida é cheia de possibilidades, perfeito para presentear quem espera uma resposta.",
       "viverei-1.webp",False),
      ("Flo","RECOMEÇO · COLAR TEMPO DE FLORESCER","O seu tempo de desabrochar chegou.",
       "A árvore da vida simboliza crescimento e raízes firmes. A frase \"Tempo de Florescer\" celebra novos ciclos e a força de quem está pronta para viver uma nova estação.",
       "florescer-1.webp",True),
      ("Pro","PROSPERIDADE · COLAR PROSPERE","Para florescer em cada área da vida.",
       "Uma cruz cravejada de zircônias com uma pequena chave na base, representando caminhos abertos e novas oportunidades. Na prata que reflete leveza, um símbolo de determinação e expansão.",
       "prospere-1.webp",False)]
purpose_keys=[]
for i,(k,eye,h,p,img,img_left) in enumerate(rows):
    g=group({f"text_{k}Eye":text(f"<p>{eye}</p>"),
             f"text_{k}H":text(f"<p>{h}</p>","h2",name="t:names.heading"),
             f"text_{k}P":text(f"<p>{p}</p>",max_width="narrow"),
             f"button_{k}":button("Ver a peça →","shopify://collections/all")},
            [f"text_{k}Eye",f"text_{k}H",f"text_{k}P",f"button_{k}"],gap=16,width="custom")
    blocks={f"group_{k}":g,f"image_{k}":image(f"shopify://shop_images/{img}")}
    order=[f"image_{k}",f"group_{k}"] if img_left else [f"group_{k}",f"image_{k}"]
    last=(i==len(rows)-1)
    key=f"section_prop{k}"
    S[key]=section(blocks,order,"t:names.image_with_text",bg=GREEN,pt=40,pb=64 if last else 40)
    purpose_keys.append(key)

# 8. Qualidade Dabela
quality=[("heart","Banho ouro 18k","Camada generosa de ouro para um brilho intenso e duradouro."),
         ("leaf","Antialérgico","Livre de níquel. Confortável até na pele mais sensível."),
         ("return","Troca grátis 30 dias","Não serviu ou quer trocar? A primeira troca é por nossa conta."),
         ("box","Embalagem presente","Chega pronta para presentear, com todo o cuidado Dabela.")]
qb={};qo=[]
for i,(ic,t,sub) in enumerate(quality):
    qb[f"group_q{i}"]=item(i,ic,t,sub,"q"); qo.append(f"group_q{i}")
S["section_quality"]=section(
  {"group_qHead":group({
      "text_qEye":text("<p>QUALIDADE DABELA</p>","rte","center"),
      "text_qH":text("<p>Feita para durar, pensada para você</p>","h2","center",name="t:names.heading"),
      "text_qP":text("<p>Cada semijoia passa por um cuidado de verdade, do banho ao acabamento, até a embalagem que chega na sua casa.</p>","rte","center",max_width="narrow")},
    ["text_qEye","text_qH","text_qP"],gap=10,h_col="center",h_align="center"),
   "group_qItems":group(qb,qo,direction="row",gap=24,h_col="center")},
  ["group_qHead","group_qItems"],"t:names.icons_with_text",direction="column",bg="",pt=64,pb=64,gap=40,h_col="center")

order=["section_eKPPTg","section_JTKzfe","product_list_fa6P9H","section_propHead"]+purpose_keys+["section_quality"]
data={"sections":S,"order":order}
header="""/*
 * ------------------------------------------------------------
 * IMPORTANT: The contents of this file are auto-generated.
 *
 * This file may be updated by the Shopify admin theme editor
 * or related systems. Please exercise caution as any changes
 * made to this file may be overwritten.
 * ------------------------------------------------------------
 */
"""
out=json.dumps(data,ensure_ascii=False,indent=2)
json.loads(out)
assert all(k in S for k in order)
for sk,sv in S.items():
    def chk(b):
        for kk in b.get("block_order",[]): assert kk in b["blocks"],(sk,kk)
        for v in b.get("blocks",{}).values(): chk(v)
    chk(sv)
open("index.json","w",encoding="utf-8").write(header+out+"\n")
print("ok", len(out), "bytes;", order)
