import json, copy

def pad0(): return {"padding-block-start":0,"padding-block-end":0,"padding-inline-start":0,"padding-inline-end":0}

def group(blocks, order, direction="column", gap=12, h_col="flex-start", width="fill", custom_width=100, h_align="flex-start", vom=True):
    s={"content_direction":direction,"vertical_on_mobile":vom,"horizontal_alignment":h_align,"vertical_alignment":"center",
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

# 1. Hero premium: foto em tela cheia, texto sobreposto embaixo à esquerda
# NOTA: "background_image" é uma inferência de schema (não confirmada), já que o
# grupo group() só expõe "background_media"/"background_color" nos exemplos que
# tínhamos. Se a foto não aparecer como fundo depois de colar, selecione a imagem
# manualmente no editor (grupo do hero > Appearance > Background media > Image).
hero_bg_group={
    "content_direction":"column","vertical_on_mobile":True,"horizontal_alignment":"flex-start","vertical_alignment":"flex-end",
    "align_baseline":False,"horizontal_alignment_flex_direction_column":"flex-start","vertical_alignment_flex_direction_column":"flex-end",
    "gap":18,"width":"fill","custom_width":100,"width_mobile":"fill","custom_width_mobile":100,"height":"fill","custom_height":100,
    "background_media":"image","background_image":"shopify://shop_images/hero-01.webp","background_color":"","video_position":"cover",
    "background_image_position":"50% 30%","toggle_overlay":True,"overlay_color":"#14160fB3","overlay_style":"gradient","gradient_direction":"to top",
    "border":"none","border_width":1,"border_opacity":100,"border_color":"","border_radius":0,"link":"","open_in_new_tab":False,"placeholder":""}
hero_bg_group.update(pad0())
hero_eye=text("<p>JOIAS COM PROPÓSITO</p>"); hero_eye["settings"]["text_color"]="#E8D9B0"
hero_h=text("<p>Joias que carregam significado.</p>","h1",name="t:names.heading"); hero_h["settings"]["text_color"]="#FFFFFF"
hero_p=text("<p>Semijoias banhadas a ouro 18k, criadas para celebrar o brilho único de cada mulher. Cada peça nasce de uma palavra que se torna presença.</p>",max_width="narrow")
hero_p["settings"]["text_color"]="#FFFFFFDB"
S["section_heroPremium"]={"type":"section","name":"t:names.image_with_text","blocks":{
    "group_heroBg":{"type":"group","settings":hero_bg_group,"blocks":{
        "text_heroEye":hero_eye,"text_heroH":hero_h,"text_heroP":hero_p,
        "button_heroCta":button("Descobrir a coleção →","shopify://collections/all")},
      "block_order":["text_heroEye","text_heroH","text_heroP","button_heroCta"]}},
  "block_order":["group_heroBg"],
  "settings":{"content_direction":"column","vertical_on_mobile":True,"horizontal_alignment":"flex-start","vertical_alignment":"center",
    "align_baseline":False,"horizontal_alignment_flex_direction_column":"flex-start","vertical_alignment_flex_direction_column":"center",
    "gap":0,"section_width":"full","section_height":"custom","section_height_custom":78,"background_media":"none","background_color":"",
    "video_position":"cover","background_image_position":"cover","toggle_overlay":False,"overlay_color":"#00000026","overlay_style":"solid",
    "gradient_direction":"to top","border":"none","border_width":1,"border_opacity":100,"border_color":"","border_radius":0,
    "padding-block-start":0,"padding-block-end":0}}

# 2. Faixa de confiança
trust=[("gxmwWM","price_tag","Pague parcelado","até 12x no cartão"),("h4HPgj","truck","Entrega garantida","para todo o Brasil"),
       ("nJJkHz","return","Primeira troca grátis","você tem 30 dias"),("Q9tBjW","lock","Compra 100% segura","seus dados protegidos")]
def item(i,ic,t,sub,prefix):
    return group({f"icon_{prefix}{i}":icon(ic),
                  f"group_{prefix}t{i}":group({f"text_{prefix}a{i}":text(f"<p><strong>{t}</strong></p>","h6","center",width="100%"),
                                               f"text_{prefix}b{i}":text(f"<p>{sub}</p>","rte","center",width="100%")},
                                              [f"text_{prefix}a{i}",f"text_{prefix}b{i}"],gap=4)},
                 [f"icon_{prefix}{i}",f"group_{prefix}t{i}"],gap=12,h_col="center")
def trust_item(i,ic,t,sub,prefix):
    # ícone à esquerda e texto à direita, como no documento; mantém lado a lado no celular
    return group({f"icon_{prefix}{i}":icon(ic),
                  f"group_{prefix}t{i}":group({f"text_{prefix}a{i}":text(f"<p><strong>{t}</strong></p>","h6","left",width="100%"),
                                               f"text_{prefix}b{i}":text(f"<p>{sub}</p>","rte","left",width="100%")},
                                              [f"text_{prefix}a{i}",f"text_{prefix}b{i}"],gap=2)},
                 [f"icon_{prefix}{i}",f"group_{prefix}t{i}"],direction="row",gap=12,vom=False)
tb={};to=[]
for i,(k,ic,t,sub) in enumerate(trust):
    tb[f"group_{k}"]=trust_item(i,ic,t,sub,"tr"); to.append(f"group_{k}")
S["section_JTKzfe"]=section(tb,to,"t:names.icons_with_text",bg=CREAM2,pt=28,pb=28,gap=16)

# 2b. Coleções em círculo
def circle_image(src):
    im=image(f"shopify://shop_images/{src}")
    im["settings"].update({"link":"shopify://collections/all","image_ratio":"square","width":"fill","custom_width":100,
        "width_mobile":"fill","custom_width_mobile":100,"height":"fit","border":"none","border_radius":100})
    return im
categorias=[("cat1","florescer-2.webp","Colares"),("cat2","filha-1.webp","Pulseiras e Braceletes"),
            ("cat3","ore-2.webp","Brincos"),("cat4","casados-1.webp","Infantil")]
cb={};co=[]
for k,img,label in categorias:
    g=group({f"image_{k}":circle_image(img),
             f"text_{k}":text(f"<p>{label}</p>","h6","center",width="100%")},
            [f"image_{k}",f"text_{k}"],gap=14,h_col="center")
    g["settings"]["width"]="custom"; g["settings"]["custom_width"]=15
    cb[f"group_{k}"]=g; co.append(f"group_{k}")
S["section_colecoes"]=section(
  {"group_colHead":group({
      "text_colEye":text("<p>EXPLORE POR COLEÇÃO</p>","rte","center"),
      "text_colH":text("<p>Cada peça, uma palavra.</p>","h2","center",name="t:names.heading")},
    ["text_colEye","text_colH"],gap=8,h_col="center",h_align="center"),
   "group_colItems":group(cb,co,direction="row",gap=40,h_col="center")},
  ["group_colHead","group_colItems"],"t:names.icons_with_text",direction="column",bg="",pt=64,pb=56,gap=36,h_col="center")

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

# 4-5. Propósito: cabeçalho + grade com as 7 peças (duas fileiras, 4 + 3 centralizada)
S["section_propHead"]=section(
  {"group_propHead":group({
      "text_propEye":text("<p>JOIAS COM PROPÓSITO</p>","rte","center"),
      "text_propH":text("<p>\"Não vendemos apenas ouro, vendemos a palavra que alguém precisa carregar perto do peito.\"</p>","h2","center",name="t:names.heading")},
    ["text_propEye","text_propH"],gap=8,h_col="center",h_align="center")},
  ["group_propHead"],"t:names.image_with_text",direction="column",bg=GREEN,pt=56,pb=40,h_col="center")

pecas=[
  ("Mil","MILAGRES","Viverei Milagres","Pingente com borboleta, para quem espera o inesperado.","viverei-2.webp"),
  ("Flo","RECOMEÇO","Tempo de Florescer","Árvore da vida cravejada, para quem está recomeçando.","florescer-1.webp"),
  ("Ore","FÉ","Ore, Espere, Confie","Medalhão sobre pérolas, para quem segue confiando.","ore-1.webp"),
  ("Pro","PROSPERIDADE","Prospere","Cruz com chave, para quem abre novos caminhos.","prospere-2.webp"),
  ("Ami","AMIZADE","Amiga de Deus","Pulseira gravada, para lembrar de quem cuida da gente.","amiga-1.webp"),
  ("Cas","UNIÃO","Casados","Pingente do casal entrelaçado, para celebrar a união.","casados-2.webp"),
  ("Fil","FAMÍLIA","Filha","Pulseira com letras, para a filha que carrega o nome da família.","filha-2.webp"),
]
def peca_card(k,eye,h,p,img):
    im=image(f"shopify://shop_images/{img}")
    im["settings"].update({"link":"shopify://collections/all","image_ratio":"portrait","border":"none","border_radius":0})
    g=group({f"image_{k}":im,
             f"text_{k}Eye":text(f"<p>{eye}</p>"),
             f"text_{k}H":text(f"<p>{h}</p>","h4",name="t:names.heading"),
             f"text_{k}P":text(f"<p>{p}</p>"),
             f"button_{k}":button("Ver a peça →","shopify://collections/all","link")},
            [f"image_{k}",f"text_{k}Eye",f"text_{k}H",f"text_{k}P",f"button_{k}"],gap=8,h_col="flex-start")
    g["settings"]["width"]="custom"; g["settings"]["custom_width"]=22
    return g
row1=pecas[:4]; row2=pecas[4:]
r1b={};r1o=[]
for k,eye,h,p,img in row1:
    r1b[f"group_{k}"]=peca_card(k,eye,h,p,img); r1o.append(f"group_{k}")
r2b={};r2o=[]
for k,eye,h,p,img in row2:
    r2b[f"group_{k}"]=peca_card(k,eye,h,p,img); r2o.append(f"group_{k}")
S["section_propGrid"]=section(
  {"group_propRow1":group(r1b,r1o,direction="row",gap=24,h_col="center"),
   "group_propRow2":group(r2b,r2o,direction="row",gap=24,h_col="center")},
  ["group_propRow1","group_propRow2"],"t:names.image_with_text",direction="column",bg=GREEN,pt=0,pb=64,gap=24,h_col="center")
purpose_keys=["section_propHead","section_propGrid"]

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


# 9. Perguntas frequentes (estrutura da seção FAQ do Horizon)
def faq_text(html):
    t=text(html,"rte",width="100%"); t["settings"]["font_size"]=""; return t
faqs=[("As semijoias escurecem com o tempo?","Com o banho de ouro 18k e cuidados simples, como evitar contato com perfume, água do mar e produtos químicos, suas peças mantêm o brilho por muito tempo."),
      ("Como funciona a troca?","Sua primeira troca é grátis: você tem 30 dias para trocar, sem burocracia. É só falar com a gente pelo WhatsApp que resolvemos para você."),
      ("Qual o prazo de entrega?","Enviamos para todo o Brasil com código de rastreio. O prazo varia conforme a sua região e a modalidade escolhida no checkout, e você acompanha cada etapa até a entrega."),
      ("Em quantas vezes posso parcelar?","Você parcela em até 12x sem juros no cartão de crédito. No PIX, confira as condições no checkout."),
      ("As peças são antialérgicas?","Sim. Nossas semijoias são livres de níquel e pensadas para o conforto de peles sensíveis, para você usar o dia inteiro sem preocupação."),
      ("O que significa \"joia com propósito\"?","Cada peça nasce de uma palavra, como fé, milagres, prosperidade e união, e traz uma frase ou símbolo que vira um lembrete diário. Mais que um acessório, é um significado que você carrega com você.")]
rows_b={};rows_o=[]
for i,(q,a) in enumerate(faqs):
    rows_b[f"accordion_row_faq{i}"]={"type":"_accordion-row","settings":{"heading":q,"open_by_default":False,"icon":"none","width":20},
        "blocks":{f"text_faq{i}":faq_text(f"<p>{a}</p>")},"block_order":[f"text_faq{i}"]}
    rows_o.append(f"accordion_row_faq{i}")
faq_head=text("<p>Perguntas frequentes</p>","h2",name="t:names.heading",max_width="narrow"); faq_head["settings"]["font_size"]=""
faq_eye=text("<p>TIRE SUAS DÚVIDAS</p>"); faq_eye["settings"]["font_size"]=""
faq_sec=section({"text_faqEye":faq_eye,"text_Lmq9Rn":faq_head,
    "accordion_bmC3XV":{"type":"accordion","name":"t:names.accordion","settings":dict({"icon":"caret","dividers":True,"divider_color":"",
        "type_preset":"h5","background_color":"","text_color":"","border":"none","border_width":1,"border_opacity":100,"border_color":"",
        "border_radius":0},**pad0()),"blocks":rows_b,"block_order":rows_o}},
  ["text_faqEye","text_Lmq9Rn","accordion_bmC3XV"],"t:names.faq_section",direction="column",bg=CREAM2,pt=64,pb=64,gap=16)
S["section_Gprabp"]=faq_sec

order=["section_heroPremium","section_JTKzfe","section_colecoes","product_list_fa6P9H"]+purpose_keys+["section_quality","section_Gprabp"]
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
