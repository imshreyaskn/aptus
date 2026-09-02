# Machine Learning Foundations: Tom Mitchell & The Hundred-Page ML Book

# Chapter 1: Concept Learning and Generalization
Concept learning is the task of inferring a boolean-valued function from training examples of its input and output. A central theme is the inductive bias: any strategy or assumptions that allow a learner to generalize from training instances to unseen instances. Without inductive bias, a learner is incapable of generalization, as it cannot differentiate between unseen hypotheses consistent with the training set. Version spaces represent the set of all hypotheses consistent with observed training data, bounded by the most specific (S) and most general (G) hypotheses.

# Chapter 2: Decision Tree Learning and Information Gain
Decision tree learning constructs a tree-structured classifier by recursively splitting data based on attributes. The ID3 and C4.5 algorithms use Entropy and Information Gain as splitting criteria. Entropy measures impurity: $H(S) = -\sum p_i \log_2(p_i)$. Information Gain is the expected reduction in entropy: $Gain(S, A) = H(S) - \sum \frac{|S_v|}{|S|} H(S_v)$. To counter bias toward attributes with many distinct values, Gain Ratio is employed. Overfitting in decision trees is addressed through pre-pruning (stopping early based on minimum sample split or maximum depth) or post-pruning (reduced-error pruning and cost-complexity pruning).

# Chapter 3: Artificial Neural Networks and Backpropagation
Artificial Neural Networks model complex nonlinear decision boundaries. Multilayer perceptrons (MLPs) use continuous activation functions such as Sigmoid, Tanh, ReLU, and GeLU. Gradient Descent minimizes the mean squared error or cross-entropy loss by computing partial derivatives with respect to each network parameter via the chain rule of calculus (Backpropagation). In backpropagation, errors at output neurons propagate backward through hidden layers:
$\delta_j = \frac{\partial E}{\partial net_j} = \sum_k \delta_k w_{kj} \sigma'(net_j)$.
Vanishing and exploding gradients occur when derivative terms compound across deep layers, which is mitigated via batch normalization, residual skip connections, and specialized initializations (He, Xavier/Glorot).

# Chapter 4: Optimization Algorithms in Machine Learning
Standard Stochastic Gradient Descent (SGD) updates parameters with individual mini-batches: $\theta = \theta - \eta \nabla L(\theta)$. Momentum accelerates SGD in relevant directions by accumulating past gradient vectors: $v_t = \gamma v_{t-1} + \eta \nabla L(\theta)$. RMSProp maintains a moving average of squared gradients to scale the learning rate adaptively per parameter: $E[g^2]_t = \beta E[g^2]_{t-1} + (1-\beta) g_t^2$. Adam (Adaptive Moment Estimation) combines momentum and RMSProp, computing exponentially decaying averages of past gradients ($m_t$) and squared gradients ($v_t$), with bias corrections to prevent initialization drift toward zero.

# Chapter 5: Regularization and Overfitting Control
Regularization prevents statistical learning models from memorizing training noise. L2 Regularization (Ridge / Weight Decay) adds a penalty proportional to the sum of squared weights: $\frac{\lambda}{2} \sum w_i^2$, pulling weights smoothly toward zero and improving conditioning. L1 Regularization (Lasso) penalizes absolute weight magnitudes: $\lambda \sum |w_i|$, driving non-critical weights to exact zero and performing sparse feature selection. Dropout randomly deactivates neurons during training with probability $p$, forcing neurons to learn robust, non-co-adapted representations, mathematically equivalent to an ensemble over exponentially many sub-networks.

# Chapter 6: Bayesian Learning and Probabilistic Models
Bayesian reasoning provides a probabilistic framework for inference. Bayes Theorem computes posterior probability: $P(h|D) = \frac{P(D|h)P(h)}{P(D)}$. The Maximum A Posteriori (MAP) hypothesis finds $\arg\max P(D|h)P(h)$, whereas Maximum Likelihood (ML) assumes equal priors and optimizes $\arg\max P(D|h)$. Naive Bayes makes the conditional independence assumption: attributes are independent given the target class. Logistic regression models the log-odds of binary outcomes using the sigmoid link function: $P(y=1|x) = \frac{1}{1 + e^{-w^T x}}$, optimized via maximum likelihood using binary cross-entropy loss.

# Chapter 7: Support Vector Machines and Kernel Methods
Support Vector Machines (SVM) maximize the margin between classes. The optimal separating hyperplane maximizes $\frac{2}{||w||}$ subject to $y_i (w^T x_i + b) \ge 1$. For non-linearly separable data, soft-margin SVM introduces slack variables $\xi_i$ penalized by hyperparameter $C$. The Kernel Trick maps input vectors into high-dimensional feature spaces where linear separation is possible without explicitly calculating high-dimensional coordinates: $K(x, z) = \langle \phi(x), \phi(z) \rangle$. Common kernels include Linear, Polynomial, and Radial Basis Function (RBF / Gaussian): $K(x, z) = \exp(-\gamma ||x - z||^2)$.

# Chapter 8: Deep Learning Architectures and Transformers
Convolutional Neural Networks (CNNs) leverage local receptive fields, shared weights, and pooling layers for translation-invariant spatial representation. Recurrent Neural Networks (RNNs) and LSTMs model sequential dependencies with gating mechanisms (input, forget, output gates) to regulate information flow and alleviate vanishing gradients. The Transformer architecture relies entirely on Self-Attention:
$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$.
Multi-Head Attention projects queries, keys, and values into multiple representation subspaces, enabling parallel processing of global sequence contexts.
