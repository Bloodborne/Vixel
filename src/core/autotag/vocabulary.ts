/**
 * 自动标签的词表：每个标签有中英文显示名和 1–3 句描述（prompt）。
 * prompt 用 EmbeddingGemma 2 的查询前缀编码（和搜索框同一条路径），与图片 / 片段向量比余弦。
 *
 * 选词原则：照片 / 视频库里"人会想按它找"的东西，且模型能稳定分辨。
 * 只放视觉上明确的概念；抽象的（"开心""回忆"）和容易错的（具体品种、地名）不放。
 * 改动词表或 prompt 后提升 VOCABULARY_VERSION：已缓存的标签向量会重算，已有的自动标签会重跑。
 */

export type Facet = 'scene' | 'subject' | 'type' | 'activity' | 'light'

export interface Label {
  /** 稳定 id（存进库里，不要改） */
  id: string
  facet: Facet
  zh: string
  en: string
  /** 编码用的描述；第一句最重要。几句的向量取平均 */
  prompts: string[]
}

export const VOCABULARY_VERSION = 'v1'

const L = (facet: Facet, id: string, zh: string, en: string, ...prompts: string[]): Label =>
  ({ id, facet, zh, en, prompts: prompts.length > 0 ? prompts : [`a photo of ${en.toLowerCase()}`] })

export const VOCABULARY: Label[] = [
  // ── 场景 ─────────────────────────────────────────────
  L('scene', 'beach', '海滩', 'Beach', 'a photo of a sandy beach by the sea', '海边的沙滩'),
  L('scene', 'sea', '大海', 'Sea', 'a photo of the open sea and waves', '大海和海浪'),
  L('scene', 'mountain', '山', 'Mountains', 'a photo of mountains and peaks', '高山风景'),
  L('scene', 'snow', '雪景', 'Snow', 'a photo of a snowy landscape covered in snow', '白雪覆盖的雪景'),
  L('scene', 'forest', '森林', 'Forest', 'a photo of a forest with many trees', '树林森林'),
  L('scene', 'lake', '湖', 'Lake', 'a photo of a calm lake', '湖泊湖面'),
  L('scene', 'river', '河流', 'River', 'a photo of a river flowing through the landscape', '河流小溪'),
  L('scene', 'waterfall', '瀑布', 'Waterfall', 'a photo of a waterfall', '瀑布'),
  L('scene', 'desert', '沙漠', 'Desert', 'a photo of a desert with sand dunes', '沙漠沙丘'),
  L('scene', 'field', '田野', 'Fields', 'a photo of green fields and meadows in the countryside', '田野草地'),
  L('scene', 'garden', '花园', 'Garden', 'a photo of a garden with flowers and plants', '花园'),
  L('scene', 'park', '公园', 'Park', 'a photo of a city park with trees and paths', '城市公园'),
  L('scene', 'city', '城市', 'City', 'a photo of a city with buildings and streets', '城市街景高楼'),
  L('scene', 'street', '街道', 'Street', 'a photo of a street with shops and pedestrians', '街道街头'),
  L('scene', 'skyline', '天际线', 'Skyline', 'a photo of a city skyline with skyscrapers', '城市天际线摩天楼'),
  L('scene', 'old_town', '老街', 'Old Town', 'a photo of historic old buildings in an old town', '古镇老街老建筑'),
  L('scene', 'bridge', '桥', 'Bridge', 'a photo of a bridge', '桥梁'),
  L('scene', 'temple', '寺庙', 'Temple', 'a photo of a temple or shrine', '寺庙古建筑'),
  L('scene', 'church', '教堂', 'Church', 'a photo of a church or cathedral', '教堂'),
  L('scene', 'museum', '博物馆', 'Museum', 'a photo of exhibits in a museum display case', '博物馆展品'),
  L('scene', 'tower', '塔', 'Tower', 'a photo of a tall tower landmark', '高塔地标'),
  L('scene', 'castle', '城堡', 'Castle', 'a photo of a castle or fortress', '城堡'),
  L('scene', 'harbor', '港口', 'Harbor', 'a photo of a harbor with boats', '港口码头'),
  L('scene', 'station', '车站', 'Station', 'a photo of a train station platform', '火车站站台'),
  L('scene', 'airport', '机场', 'Airport', 'a photo of an airport terminal or airplanes at an airport', '机场'),
  L('scene', 'road', '公路', 'Road', 'a photo of a road or highway through the landscape', '公路'),
  L('scene', 'restaurant', '餐厅', 'Restaurant', 'a photo of the inside of a restaurant or cafe', '餐厅咖啡馆'),
  L('scene', 'bar', '酒吧', 'Bar', 'a photo of a bar counter with drinks', '酒吧吧台'),
  L('scene', 'shop', '商店', 'Shop', 'a photo of a shop or store front', '商店店铺'),
  L('scene', 'market', '市场', 'Market', 'a photo of a busy market with stalls', '集市菜市场'),
  L('scene', 'kitchen', '厨房', 'Kitchen', 'a photo of a kitchen', '厨房'),
  L('scene', 'bedroom', '卧室', 'Bedroom', 'a photo of a bedroom with a bed', '卧室'),
  L('scene', 'living_room', '客厅', 'Living Room', 'a photo of a living room with a sofa', '客厅沙发'),
  L('scene', 'office', '办公室', 'Office', 'a photo of an office with desks and computers', '办公室'),
  L('scene', 'classroom', '教室', 'Classroom', 'a photo of a classroom', '教室'),
  L('scene', 'stage', '舞台', 'Stage', 'a photo of a stage with performers and lights', '舞台演出'),
  L('scene', 'stadium', '体育场', 'Stadium', 'a photo of a sports stadium', '体育场'),
  L('scene', 'pool', '泳池', 'Swimming Pool', 'a photo of a swimming pool', '游泳池'),
  L('scene', 'underwater', '水下', 'Underwater', 'an underwater photo with fish and coral', '水下海底'),
  L('scene', 'sky', '天空', 'Sky', 'a photo of the sky with clouds', '天空云朵'),
  L('scene', 'space', '太空', 'Space', 'a photo of outer space, planets or stars', '太空星空宇宙'),
  L('scene', 'rocks', '岩石', 'Rocks', 'a photo of rock formations and cliffs', '岩石悬崖'),
  L('scene', 'island', '海岛', 'Island', 'a photo of a tropical island', '海岛'),
  L('scene', 'countryside', '乡村', 'Countryside', 'a photo of a village in the countryside', '乡村村庄'),
  L('scene', 'interior', '室内', 'Indoors', 'a photo taken indoors inside a room', '室内房间'),

  // ── 主体 ─────────────────────────────────────────────
  L('subject', 'people', '人物', 'People', 'a photo of people', '人物照片'),
  L('subject', 'portrait', '人像', 'Portrait', 'a portrait photo of a person looking at the camera', '人像肖像'),
  L('subject', 'group', '合影', 'Group Photo', 'a group photo of several people posing together', '多人合影'),
  L('subject', 'selfie', '自拍', 'Selfie', 'a selfie taken with a phone', '自拍'),
  L('subject', 'baby', '婴儿', 'Baby', 'a photo of a baby', '婴儿宝宝'),
  L('subject', 'child', '儿童', 'Children', 'a photo of young children', '小孩儿童'),
  L('subject', 'crowd', '人群', 'Crowd', 'a photo of a large crowd of people', '人群'),
  L('subject', 'dog', '狗', 'Dog', 'a photo of a dog', '狗'),
  L('subject', 'cat', '猫', 'Cat', 'a photo of a cat', '猫'),
  L('subject', 'bird', '鸟', 'Birds', 'a photo of a bird', '鸟'),
  L('subject', 'horse', '马', 'Horse', 'a photo of a horse', '马'),
  L('subject', 'fish', '鱼', 'Fish', 'a photo of fish', '鱼'),
  L('subject', 'insect', '昆虫', 'Insects', 'a close-up photo of an insect such as a butterfly or bee', '昆虫蝴蝶蜜蜂'),
  L('subject', 'wildlife', '野生动物', 'Wildlife', 'a photo of wild animals in nature', '野生动物'),
  L('subject', 'farm_animal', '家畜', 'Farm Animals', 'a photo of farm animals such as cows, sheep or pigs', '牛羊家畜'),
  L('subject', 'flower', '花', 'Flowers', 'a close-up photo of flowers', '花朵鲜花'),
  L('subject', 'tree', '树', 'Trees', 'a photo of a tree', '树木'),
  L('subject', 'plant', '植物', 'Plants', 'a photo of green plants and leaves', '绿植植物叶子'),
  L('subject', 'cactus', '仙人掌', 'Cactus', 'a photo of a cactus', '仙人掌'),
  L('subject', 'food', '美食', 'Food', 'a photo of food on a plate', '美食菜肴'),
  L('subject', 'dessert', '甜点', 'Dessert', 'a photo of a dessert such as cake or ice cream', '蛋糕甜点'),
  L('subject', 'fruit', '水果', 'Fruit', 'a photo of fresh fruit', '水果'),
  L('subject', 'coffee', '咖啡', 'Coffee', 'a photo of a cup of coffee', '一杯咖啡'),
  L('subject', 'drink', '饮品', 'Drinks', 'a photo of drinks in glasses', '饮料饮品'),
  L('subject', 'beer', '啤酒', 'Beer', 'a photo of beer', '啤酒'),
  L('subject', 'car', '汽车', 'Car', 'a photo of a car', '汽车'),
  L('subject', 'bicycle', '自行车', 'Bicycle', 'a photo of a bicycle', '自行车'),
  L('subject', 'motorcycle', '摩托车', 'Motorcycle', 'a photo of a motorcycle', '摩托车'),
  L('subject', 'train', '火车', 'Train', 'a photo of a train on the tracks', '火车列车'),
  L('subject', 'airplane', '飞机', 'Airplane', 'a photo of an airplane', '飞机'),
  L('subject', 'boat', '船', 'Boat', 'a photo of a boat or ship on the water', '船只轮船'),
  L('subject', 'rocket', '火箭', 'Rocket', 'a photo of a rocket launch', '火箭发射'),
  L('subject', 'building', '建筑', 'Architecture', 'a photo of architecture and building facades', '建筑外观'),
  L('subject', 'statue', '雕塑', 'Sculpture', 'a photo of a statue or sculpture', '雕像雕塑'),
  L('subject', 'fountain', '喷泉', 'Fountain', 'a photo of a water fountain', '喷泉'),
  L('subject', 'artwork', '艺术品', 'Artwork', 'a photo of a painting or artwork on display', '画作艺术品'),
  L('subject', 'antique', '文物', 'Antiques', 'a photo of an ancient artifact or relic', '古代文物'),
  L('subject', 'book', '书', 'Books', 'a photo of a book', '书本'),
  L('subject', 'computer', '电脑', 'Computer', 'a photo of a laptop or computer', '电脑笔记本'),
  L('subject', 'phone', '手机', 'Phone', 'a photo of a smartphone', '手机'),
  L('subject', 'camera', '相机', 'Camera', 'a photo of a camera', '相机'),
  L('subject', 'toy', '玩具', 'Toys', 'a photo of toys', '玩具'),
  L('subject', 'clothing', '服装', 'Clothing', 'a photo of clothes and fashion', '服装衣服'),
  L('subject', 'shoes', '鞋', 'Shoes', 'a photo of shoes', '鞋子'),
  L('subject', 'furniture', '家具', 'Furniture', 'a photo of furniture', '家具'),
  L('subject', 'fireworks', '烟花', 'Fireworks', 'a photo of fireworks in the night sky', '烟花'),
  L('subject', 'christmas', '圣诞', 'Christmas', 'a photo of a Christmas tree and decorations', '圣诞树'),
  L('subject', 'cake_celebration', '蛋糕', 'Birthday Cake', 'a photo of a birthday cake with candles', '生日蛋糕蜡烛'),

  // ── 类型 ─────────────────────────────────────────────
  L('type', 'screenshot', '截图', 'Screenshot', 'a screenshot of a phone or computer screen', '手机屏幕截图'),
  L('type', 'document', '文档', 'Document', 'a photo of a printed document page with text', '文件文档'),
  L('type', 'receipt', '票据', 'Receipt', 'a photo of a receipt or invoice', '收据发票小票'),
  L('type', 'ticket', '票', 'Ticket', 'a photo of a ticket such as a train or concert ticket', '车票门票'),
  L('type', 'poster', '海报', 'Poster', 'a poster with large text and graphics', '海报'),
  L('type', 'sign', '招牌', 'Signs', 'a photo of a sign with text', '招牌标识牌'),
  L('type', 'menu', '菜单', 'Menu', 'a photo of a restaurant menu', '菜单价目表'),
  L('type', 'map', '地图', 'Map', 'a map', '地图'),
  L('type', 'chart', '图表', 'Chart', 'a chart or graph with data', '图表数据'),
  L('type', 'whiteboard', '白板', 'Whiteboard', 'a photo of a whiteboard with writing', '白板板书'),
  L('type', 'notes', '笔记', 'Notes', 'a photo of handwritten notes in a notebook', '手写笔记本'),
  L('type', 'meme', '表情包', 'Meme', 'a meme image with funny text', '表情包'),
  L('type', 'illustration', '插画', 'Illustration', 'a digital illustration or drawing', '插画手绘'),
  L('type', 'cartoon', '卡通', 'Cartoon', 'a cartoon or anime image', '卡通动漫'),
  L('type', 'logo', 'Logo', 'Logo', 'a logo design on a plain background', '标志logo'),
  L('type', 'qr', '二维码', 'QR Code', 'a photo of a QR code', '二维码'),
  L('type', 'id_card', '证件', 'ID Document', 'a photo of an ID card or passport', '证件身份证护照'),
  L('type', 'black_white', '黑白', 'Black & White', 'a black and white photo', '黑白照片'),
  L('type', 'vintage', '老照片', 'Vintage Photo', 'an old vintage photograph', '老照片'),
  L('type', 'aerial', '航拍', 'Aerial', 'an aerial photo taken from a drone high above', '航拍俯瞰'),
  L('type', 'macro', '微距', 'Macro', 'an extreme close-up macro photo', '微距特写'),
  L('type', 'panorama', '全景', 'Panorama', 'a wide panoramic landscape photo', '全景'),

  // ── 活动 ─────────────────────────────────────────────
  L('activity', 'wedding', '婚礼', 'Wedding', 'a photo of a wedding ceremony with bride and groom', '婚礼'),
  L('activity', 'party', '聚会', 'Party', 'a photo of people at a party', '聚会派对'),
  L('activity', 'concert', '演唱会', 'Concert', 'a photo of a concert with a crowd and stage lights', '演唱会'),
  L('activity', 'dance', '跳舞', 'Dancing', 'a photo of people dancing', '跳舞'),
  L('activity', 'meal', '聚餐', 'Dining', 'a photo of people eating a meal together at a table', '一起吃饭聚餐'),
  L('activity', 'cooking', '做饭', 'Cooking', 'a photo of someone cooking food in a kitchen', '做饭烹饪'),
  L('activity', 'travel', '旅行', 'Travel', 'a travel photo of a tourist sightseeing', '旅行旅游'),
  L('activity', 'hiking', '徒步', 'Hiking', 'a photo of people hiking on a mountain trail', '徒步登山'),
  L('activity', 'camping', '露营', 'Camping', 'a photo of a tent at a campsite', '露营帐篷'),
  L('activity', 'swimming', '游泳', 'Swimming', 'a photo of people swimming', '游泳'),
  L('activity', 'surfing', '冲浪', 'Surfing', 'a photo of a surfer riding a wave', '冲浪'),
  L('activity', 'skiing', '滑雪', 'Skiing', 'a photo of people skiing on snow', '滑雪'),
  L('activity', 'cycling', '骑行', 'Cycling', 'a photo of people riding bicycles', '骑自行车'),
  L('activity', 'running', '跑步', 'Running', 'a photo of people running', '跑步'),
  L('activity', 'soccer', '足球', 'Soccer', 'a photo of a soccer match', '踢足球'),
  L('activity', 'basketball', '篮球', 'Basketball', 'a photo of a basketball game', '打篮球'),
  L('activity', 'sports', '运动', 'Sports', 'a photo of a sports game', '体育运动比赛'),
  L('activity', 'fishing', '钓鱼', 'Fishing', 'a photo of someone fishing', '钓鱼'),
  L('activity', 'shopping', '购物', 'Shopping', 'a photo of people shopping in a store', '逛街购物'),
  L('activity', 'meeting', '会议', 'Meeting', 'a photo of a business meeting in a conference room', '开会会议'),
  L('activity', 'presentation', '演讲', 'Presentation', 'a photo of a person giving a talk on stage', '演讲讲座'),
  L('activity', 'graduation', '毕业', 'Graduation', 'a photo of a graduation ceremony with caps and gowns', '毕业典礼'),
  L('activity', 'birthday', '生日', 'Birthday', 'a photo of a birthday party', '生日派对'),
  L('activity', 'parade', '游行', 'Parade', 'a photo of a street parade or festival', '游行节日庆典'),
  L('activity', 'driving', '开车', 'Driving', 'a photo taken from inside a car while driving on the road', '开车行车记录'),

  // ── 时间 / 光线 ─────────────────────────────────────
  L('light', 'sunset', '日落', 'Sunset', 'a photo of a sunset with an orange sky', '日落夕阳'),
  L('light', 'sunrise', '日出', 'Sunrise', 'a photo of a sunrise at dawn', '日出'),
  L('light', 'night', '夜景', 'Night', 'a photo taken at night with city lights', '夜景'),
  L('light', 'starry_sky', '星空', 'Starry Sky', 'a photo of a starry night sky', '星空银河'),
  L('light', 'golden_hour', '黄昏', 'Golden Hour', 'a photo in warm golden evening light', '黄昏暖光'),
  L('light', 'fog', '雾', 'Fog', 'a photo of a foggy misty landscape', '雾天薄雾'),
  L('light', 'rain', '雨天', 'Rain', 'a photo of a rainy day with wet streets', '下雨天'),
  L('light', 'snowing', '下雪', 'Snowfall', 'a photo of snow falling', '下雪'),
  L('light', 'neon', '霓虹', 'Neon', 'a photo of neon lights at night', '霓虹灯'),
  L('light', 'silhouette', '剪影', 'Silhouette', 'a silhouette against a bright background', '剪影'),
  L('light', 'autumn', '秋天', 'Autumn', 'a photo of an autumn landscape with fall colors', '秋天秋景'),
  L('light', 'spring', '春天', 'Spring', 'a photo of spring with cherry blossoms', '春天樱花'),
]
