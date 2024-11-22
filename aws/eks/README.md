## Deploy Friendli Container with EKS-addon from AWS Marketplace

**Friendli Container** is a EKS addon package of the [Friendli Container](https://friendli.ai/products/container).

This document demonstrates how to deploy the LLM model on Amazon EKS. The [yaml directory](https://github.com/friendliai/examples/tree/main/aws/eks/yaml) contains example Kubernetes manifests.

### Pre-requisites

- You should have administrative privileges with a working AWS EKS cluster.
  - The EKS cluster should have node group with GPU-enabled instances.
  - Currently, the EKS add-on package for Friendli Container only supports A100, H100, A10G, and L4 GPUs.
- [AWS Command Line Interface (AWS CLI)](https://docs.aws.amazon.com/en_us/cli/latest/userguide/getting-started-install.html) version 2.12.3 or later.
  - You can check the version of the current installation with `aws --version`
- [AWS eksctl tool](https://docs.aws.amazon.com/en_us/eks/latest/userguide/getting-started-eksctl.html) version 0.194.0 or later.
  - You can check the version of the current installation with `eksctl version`

### Subscribe to the Friendli Container product

To subscribe to Friendli Container:

1. Open the marketplace listing page: [Friendli Container(TODO: Update URL)](https://aws.amazon.com/marketplace)
2. On the AWS Marketplace listing, click on the **View purchase options** button.
3. On the **Create an agreement for this software** page, review and click on **"Add a purchase order"** if you and your organization agrees with the EULA, pricing, and the support terms.
4. Once you click on the **Continue to configuration** button and choose your **region**, you will see a **Product ARN** displayed. This is the container and helm ARN that you need to specify while creating Friendli Container on EKS. Copy the ARN corresponding to your region.

### Configure the Cluster

#### Install the CRDs

Using the kubectl tool, you can install the CRDs from the file in the [yaml directory](https://github.com/friendliai/examples/tree/main/aws/eks/yaml).

```sh
kubectl apply -f 0-crd.yaml
```

#### Configure the Service Account

Save the following JSON file to your local computer directory.

```yaml
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "license-manager:CheckoutLicense",
                "license-manager:ExtendLicenseConsumption",
                "license-manager:ListReceivedLicenses",
                "license-manager:CheckInLicense",
                "license-manager:GetLicense"
            ],
            "Resource": "*"
        }
    ]
}
```

And using the AWS CLI:

```sh
aws iam create-policy --policy-name [POLICY_NAME] --policy-document file://[PATH_TO_POLICY.json]
```

where

- `[POLICY_NAME]` is the name of the new IAM policy.
- `[PATH_TO_POLICY.json]` is path to the JSON file in your local computer directory.


Using the eksctl tool:

```sh
eksctl create iamserviceaccount --namespace [NAMESPACE] --name [SERVICE_ACCOUNT_NAME] \
  --cluster [EKS_CLUSTER_NAME] --role-name [ROLE_NAME] \
  --attach-policy-arn arn:aws:iam::[AWS_ACCOUNT_ID]:policy/[POLICY_NAME] --approve
```

where

- `[NAMESPACE]` is the namespace you want to launch the Friendli Container pods.
  (e.g. default)
- `[SERVICE_ACCOUNT_NAME]` is the name of the newly created Kubernetes ServiceAccount.
  (e.g. friendli-container-service-account)
- `[EKS_CLUSTER_NAME]` is the name of the EKS cluster.
- `[ROLE_NAME]` is the name of the IAM role to be created.
- `[AWS_ACCOUNT_ID]` is the numeric ID of your AWS account.
- `[POLICY_NAME]` is the name of the policy created during the previous step.

#### Create the secret

You can use kubectl tool to create the secret.

```sh
kubectl create secret generic [SECRET_NAME] -n [NAMESPACE] \
  --from-literal container_secret=AWS_EKS_LICENSE_MANAGER \
  --from-literal huggingface_token=[HUGGINGFACE_TOKEN]
```

where

- `[SECRET_NAME]` is the name of the secret (e.g. friendli-container-secret)
- `[NAMESPACE]` is the namespace you want to launch the Friendli Container pods.
- `[HUGGINGFACE_TOKEN]` is the HuggingFace API token. (optional)
  - This is needed if you want to deploy a private or gated LLM model from HuggingFace.

#### Create the FriendliConfig

FriendliConfig contains the required configurations to launch your FriendliDeployments.

Save the following yaml file to your local computer directory.

```yaml
apiVersion: friendli.ai/v1alpha1
kind: FriendliConfig
metadata:
  namespace: [NAMESPACE]
  name: friendli-container-config
spec:
  serviceAccountName: [SERVICE_ACCOUNT_NAME]
  containerSecret:
    name: [SECRET_NAME]
    key: container_secret
  modelRepositorySecrets:
    huggingFaceToken:
      name: [SECRET_NAME]
      key: huggingface_token
```

where

- `[NAMESPACE]` is the namespace you want to launch the Friendli Container pods.
- `[SERVICE_ACCOUNT_NAME]` is the name of the ServiceAccount in the previous step (e.g. friendli-container-service-account)
- `[SECRET_NAME]` is the name of the secret in the previous step (e.g. friendli-container-secret)

Create the FriendliConfig resource.

```sh
kubectl apply -f [PATH_TO_FRIENDLI_CONFIG.yaml]
```

### Create Friendi Container and perform real-time inference

#### Launch the FriendliDeployment

Save the following yaml file to your local computer directory.

```yaml
apiVersion: friendli.ai/v1alpha1
kind: FriendliDeployment
metadata:
  namespace: default
  name: friendlideployment-sample
spec:
  engine:
    image: [ENGINE_IMAGE]
  model:
    huggingFace:
      repository: [REPO_NAME]
  resources:
    #
    # Replace with appropriate NodeSelector for your environment.
    #
    nodeSelector:
      gpu-type: a100-80g

    #
    # When designating resource limits and requests:
    #
    #   - You should consider whether your EKS nodes have ephemeral storage or not.
    #   - Memory size should be larger than the size of your LLM model of choice.
    #
    requests:
      cpu: "12"
      ephemeral-storage: 100Gi
      memory: 40Gi
      nvidia.com/gpu: "1"
    limits:
      cpu: "12"
      ephemeral-storage: 100Gi
      memory: 40Gi
      nvidia.com/gpu: "1"
```

where

- `[ENGINE_IMAGE]` is the container image in AWS ECR, for your engine version of choice.
  (e.g. `709825985650.dkr.ecr.us-east-1.amazonaws.com/friendliai/orca:v1.7.16`)
- `[REPO_NAME]` is the HuggingFace repository name.
  (e.g. `meta-llama/Llama-3.1-8B-Instruct`)

```sh
kubectl apply -f [PATH_TO_FRIENDLI_DEPLOYMENT.yaml]
```

#### Come up with inference request payload

Request/response payloads are compatible with the OpenAI chat completion endpoint.

The input payload is composed of:
- **messages**(**required**, list of objects): A list of messages comprising the conversation so far.
  - **role**(**required**, [`system`, `user`, `assistant`, `tool`]): The role of the messages author.
  - **content**(**required**, string): The content of message
- frequency_penalty(float): Number between -2.0 and 2.0. Positive values penalizes tokens that have been sampled, taking into account their frequency in the preceding text. This penalization diminishes the model's tendency to reproduce identical lines verbatim.
- presence_penalty(float): Penalizes tokens that have already appeared in the generated result (plus the input tokens for decoder-only models). should be greater than or equal to 1.0. 1.0 means no penalty. see keskar et al., 2019 for more details. this is similar to Hugging Face's [repetition_penalty](https://huggingface.co/docs/transformers/v4.26.0/en/main_classes/text_generation#transformers.generationconfig.repetition_penalty) argument.
- max_tokens(integer): The maximum number of tokens to generate. For decoder-only models like GPT, the length of your input tokens plus `max_tokens` should not exceed the model's maximum length (e.g., 2048 for OpenAI GPT-3). For encoder-decoder models like T5 or BlenderBot, `max_tokens` should not exceed the model's maximum output length. This is similar to Hugging Face's [max_new_tokens](https://huggingface.co/docs/transformers/v4.26.0/en/main_classes/text_generation#transformers.GenerationConfig.max_new_tokens) argument.
- min_tokens(integer): The minimum number of tokens to generate. default value is 0. this is similar to hugging face's [min_new_tokens](https://huggingface.co/docs/transformers/v4.26.0/en/main_classes/text_generation#transformers.generationconfig.min_new_tokens) argument.
- n(integer): The number of independently generated results for the prompt. Not supported when using beam search. Defaults to 1. This is similar to Hugging Face's [num_return_sequences](https://huggingface.co/docs/transformers/v4.26.0/en/main_classes/text_generation#transformers.GenerationConfig.num_return_sequences) argument.
- stop(list of strings): When one of the stop phrases appears in the generation result, the API will stop generation. The stop phrases are excluded from the result. Defaults to empty list.
- stream(boolean): Whether to stream generation result. When set true, each token will be sent as [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format) once generated.
- temperature(float): Sampling temperature. Smaller temperature makes the generation result closer to greedy, argmax (i.e., `top_k = 1`) sampling. defaults to 1.0. this is similar to hugging face's [temperature argument](https://huggingface.co/docs/transformers/v4.26.0/en/main_classes/text_generation#transformers.generationconfig.temperature).
- top_p(float): Tokens comprising the top `top_p` probability mass are kept for sampling. Numbers between 0.0 (exclusive) and 1.0 (inclusive) are allowed. Defaults to 1.0. This is similar to Hugging Face's [top_p](https://huggingface.co/docs/transformers/v4.26.0/en/main_classes/text_generation#transformers.GenerationConfig.top_p) argument.
- top_k(integer): The number of highest probability tokens to keep for sampling. Numbers between 0 and the vocab size of the model (both inclusive) are allowed. The default value is 0, which means that the API does not apply top-k filtering. This is similar to Hugging Face's [top_k](https://huggingface.co/docs/transformers/v4.26.0/en/main_classes/text_generation#transformers.GenerationConfig.top_k) argument.
- timeout_microseconds(integer): Request timeout. Gives the `HTTP 429 Too Many Requests` response status code. Default behavior is no timeout.
- seed(list of integers): Seed to control random procedure. If nothing is given, random seed is used for sampling, and return the seed along with the generated result. When using the `n` argument, you can pass a list of seed values to control all of the independent generations.
- eos_token(list of integers): A list of endpoint sentence tokens.

[More information about request payload](https://friendli.ai/docs/openapi/dedicated/chat-completions)

```python
# Input payload example
input_payload = {
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 200,
}
```

#### Perform real-time inference

First, check the readiness of the Friendli Container pod.

```sh
kubectl get pods
```

```
NAME                                                              READY   STATUS      RESTARTS         AGE
friendlideployment-sample-5bf478f8dd-7vhfb                        2/2     Running     0                2m4s
```

If the pod READY field is `2/2`, you are good to go.

The deployment comes with a [ClusterIP service](https://kubernetes.io/docs/concepts/services-networking/service/#type-clusterip).

```sh
kubectl get services
```

```
NAME                              TYPE           CLUSTER-IP       EXTERNAL-IP      PORT(S)       AGE
friendlideployment-sample         ClusterIP      172.17.184.58    <none>           6000/TCP      2m16s
```

Execute a port-forward command so that you can perform an inference request from your computer:

```sh
kubectl port-forward svc/friendlideployment-sample 6000
```

where you should replace `friendlideployment-sample` with the name of the service you checked in the previous step.

Now you can request an inference from your Python script:

```python
import requests
SERVER = "localhost:6000/v1/chat/completions"

response = requests.post(SERVER, json=input_payload)
print(response)
```

[More infromantion about response format](https://friendli.ai/docs/openapi/dedicated/chat-completions)

### Cleanup

You can delete FriendliDepoyment any time.

```
kubectl delete FriendliDepoyment friendlideployment-sample
```

where you should replace `friendlideployment-sample` with the name of the FriendliDeployment you created.
